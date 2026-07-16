import assert from "node:assert/strict";
import test from "node:test";
import { AgentDriver, LizaController } from "./controller.js";
import { DosPeer, ShellResult } from "./dos-peer.js";
import { encodeExitCode, Frame, FrameDecoder, MessageType } from "./protocol.js";
import type { DosContext } from "./personality.js";
import type { FileOperations } from "./file-tools.js";

class FakeAgent implements AgentDriver {
  executor: ((command: string) => Promise<ShellResult>) | undefined;
  runs: string[] = [];
  aborted = false;
  sessions = 1;
  context: DosContext | undefined;
  fileOperations: FileOperations | undefined;

  setShellExecutor(executor: (command: string) => Promise<ShellResult>): void {
    this.executor = executor;
  }

  setDosContext(context: DosContext): void { this.context = context; }
  setFileOperations(operations: FileOperations): void { this.fileOperations = operations; }

  async run(prompt: string, onText: (text: string) => void): Promise<void> {
    this.runs.push(prompt);
    onText("Let me do it for you.");
    const result = await this.executor!("DIR *.TXT /O:-S");
    assert.match(result.output, /NOTES/);
    onText("Done, the file has saved.\n");
  }

  async abort(): Promise<void> { this.aborted = true; }
  async newSession(): Promise<void> { this.sessions += 1; }
  dispose(): void {}
}

function decode(wire: Buffer): Frame {
  return new FrameDecoder().push(wire)[0]!;
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("flushes streamed text before displaying a shell tool call", async () => {
  const agent = new FakeAgent();
  const outgoing: Frame[] = [];
  let peer: DosPeer;
  peer = new DosPeer((wire) => {
    const frame = decode(wire);
    outgoing.push(frame);
    if (frame.type === MessageType.ExecRequest) {
      peer.receive({ type: MessageType.ExecResultChunk, sequence: frame.sequence, payload: Buffer.from("NOTES.TXT 18432\r\n") });
      peer.receive({
        type: MessageType.ExecResultEnd,
        sequence: frame.sequence,
        payload: Buffer.concat([encodeExitCode(0), Buffer.from("C:\\")]),
      });
    }
  });
  new LizaController(agent).attach(peer);

  peer.receive({ type: MessageType.PromptChunk, sequence: 40, payload: Buffer.from("find the largest text file") });
  peer.receive({ type: MessageType.PromptEnd, sequence: 40, payload: Buffer.alloc(0) });
  await settle();

  assert.deepEqual(agent.runs, ["find the largest text file"]);
  assert.equal(outgoing.filter((frame) => frame.type === MessageType.ExecRequest).length, 1);
  assert.equal(outgoing.filter((frame) => frame.type === MessageType.Complete).length, 1);
  const visible = outgoing
    .filter((frame) => frame.type === MessageType.StyledAssistantChunk)
    .map((frame) => frame.payload.subarray(1).toString("ascii"))
    .join("");
  assert.equal(visible, "Let me do it for you.Done, the file has saved.\n");
  assert.doesNotMatch(visible, /18432/);

  const firstText = outgoing.findIndex((frame) =>
    frame.type === MessageType.StyledAssistantChunk && frame.payload.subarray(1).toString("ascii") === "Let me do it for you.");
  const command = outgoing.findIndex((frame) => frame.type === MessageType.ExecRequest);
  const lastText = outgoing.findIndex((frame) =>
    frame.type === MessageType.StyledAssistantChunk && frame.payload.subarray(1).toString("ascii") === "Done, the file has saved.");
  assert.ok(firstText < command);
  assert.ok(command < lastText);
});

test("starts a fresh persistent conversation on request", async () => {
  const agent = new FakeAgent();
  const outgoing: Frame[] = [];
  const peer = new DosPeer((wire) => outgoing.push(decode(wire)));
  new LizaController(agent).attach(peer);
  peer.receive({ type: MessageType.NewSession, sequence: 22, payload: Buffer.alloc(0) });
  await settle();
  assert.equal(agent.sessions, 2);
  assert.deepEqual(outgoing.map((frame) => frame.type), [MessageType.AssistantChunk, MessageType.Complete]);
});
