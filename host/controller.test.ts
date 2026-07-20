import assert from "node:assert/strict";
import test from "node:test";
import { LizaController } from "./controller.js";
import type { AgentDriver, AgentStatus, DosSessionPort } from "./agent-driver.js";
import { DosPeer } from "./dos-peer.js";
import { Frame, FrameDecoder, MessageType } from "./protocol.js";
import { encodeExitCode } from "./dos-simulator.js";

class FakeAgent implements AgentDriver {
  port: DosSessionPort | undefined;
  runs: string[] = [];
  aborted = false;
  sessions = 1;
  status: AgentStatus = {
    model: "mimo",
    effort: "high",
    availableModels: ["mimo", "ds"],
    availableEfforts: ["off", "high"],
  };

  async connect(port: DosSessionPort): Promise<void> {
    this.port = port;
    this.sessions += 1;
  }
  disconnect(): void { this.port = undefined; }
  getStatus(): AgentStatus { return this.status; }
  async setModel(alias: string): Promise<AgentStatus> {
    if (!this.status.availableModels.includes(alias)) throw new RangeError(`Unknown model: ${alias}`);
    this.status = { ...this.status, model: alias };
    return this.status;
  }
  setEffort(effort: string): AgentStatus {
    if (!this.status.availableEfforts.includes(effort)) throw new RangeError(`Unknown effort: ${effort}`);
    this.status = { ...this.status, effort };
    return this.status;
  }

  async run(prompt: string, onText: (text: string) => void): Promise<void> {
    this.runs.push(prompt);
    onText("before");
    const result = await this.port!.execute("DIR *.TXT /O:-S");
    assert.match(result.output, /NOTES/);
    onText("after\n");
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
        payload: Buffer.concat([encodeExitCode(0), Buffer.from([1]), Buffer.from("C:\\")]),
      });
    }
  });
  new LizaController(agent).attach(peer);

  peer.receive({
    type: MessageType.SessionStart,
    sequence: 39,
    payload: Buffer.concat([Buffer.from([1]), Buffer.from("C:\\")]),
  });
  await peer.whenInboundIdle();

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
  assert.equal(visible, "beforeafter\n");
  assert.doesNotMatch(visible, /18432/);

  const firstText = outgoing.findIndex((frame) =>
    frame.type === MessageType.StyledAssistantChunk && frame.payload.subarray(1).toString("ascii") === "before");
  const command = outgoing.findIndex((frame) => frame.type === MessageType.ExecRequest);
  const lastText = outgoing.findIndex((frame) =>
    frame.type === MessageType.StyledAssistantChunk && frame.payload.subarray(1).toString("ascii") === "after");
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

test("starts a new Pi session for each DOS launch", async () => {
  const agent = new FakeAgent();
  const outgoing: Frame[] = [];
  const peer = new DosPeer((wire) => outgoing.push(decode(wire)));
  new LizaController(agent).attach(peer);

  peer.receive({
    type: MessageType.SessionStart,
    sequence: 31,
    payload: Buffer.concat([Buffer.from([1]), Buffer.from("C:\\WORK")]),
  });
  await settle();

  assert.equal(agent.sessions, 2);
  assert.deepEqual(agent.port?.context, { mode: 1, cwd: "C:\\WORK" });
  assert.deepEqual(outgoing.map((frame) => [frame.type, frame.sequence]), [
    [MessageType.SessionReady, 31],
  ]);
});

test("handles model, effort, and status commands without prompting the agent", async () => {
  const agent = new FakeAgent();
  const outgoing: Frame[] = [];
  const peer = new DosPeer((wire) => outgoing.push(decode(wire)));
  new LizaController(agent).attach(peer);

  for (const [sequence, command] of [[41, "/status"], [42, "/effort off"], [43, "/model ds"]] as const) {
    peer.receive({ type: MessageType.PromptChunk, sequence, payload: Buffer.from(command) });
    peer.receive({ type: MessageType.PromptEnd, sequence, payload: Buffer.alloc(0) });
    await settle();
  }

  assert.deepEqual(agent.runs, []);
  assert.equal(agent.status.model, "ds");
  assert.equal(agent.status.effort, "off");
  assert.equal(outgoing.filter((frame) => frame.type === MessageType.Complete).length, 3);
});

test("replies with an error for unknown slash commands", async () => {
  const agent = new FakeAgent();
  const outgoing: Frame[] = [];
  const peer = new DosPeer((wire) => outgoing.push(decode(wire)));
  new LizaController(agent).attach(peer);

  peer.receive({ type: MessageType.PromptChunk, sequence: 44, payload: Buffer.from("/frobnicate now") });
  peer.receive({ type: MessageType.PromptEnd, sequence: 44, payload: Buffer.alloc(0) });
  await settle();

  assert.deepEqual(agent.runs, []);
  const reply = outgoing.find((frame) => frame.type === MessageType.AssistantChunk);
  assert.equal(reply?.payload.toString("ascii"), "Unknown command '/frobnicate'. Run /help to see available commands.\n");
});

test("a cancel emits exactly one Cancelled error frame before Complete", async () => {
  const agent = new FakeAgent();
  let rejectRun!: (error: Error) => void;
  agent.run = () => new Promise<void>((_resolve, reject) => { rejectRun = reject; });
  agent.abort = async () => {
    agent.aborted = true;
    rejectRun(new Error("agent turn aborted"));
  };
  const outgoing: Frame[] = [];
  const peer = new DosPeer((wire) => outgoing.push(decode(wire)));
  new LizaController(agent).attach(peer);

  peer.receive({ type: MessageType.SessionStart, sequence: 50, payload: Buffer.concat([Buffer.from([1]), Buffer.from("C:\\")]) });
  await settle();
  peer.receive({ type: MessageType.PromptChunk, sequence: 51, payload: Buffer.from("work") });
  peer.receive({ type: MessageType.PromptEnd, sequence: 51, payload: Buffer.alloc(0) });
  await settle();
  peer.receive({ type: MessageType.Cancel, sequence: 51, payload: Buffer.alloc(0) });
  await settle();
  await settle();

  assert.ok(agent.aborted);
  const errors = outgoing.filter((frame) => frame.type === MessageType.Error);
  assert.equal(errors.length, 1, "exactly one error frame per cancelled turn");
  assert.equal(errors[0]!.payload.toString("ascii"), "Cancelled");
  const completes = outgoing.filter((frame) => frame.type === MessageType.Complete);
  assert.equal(completes.length, 1);
  assert.ok(outgoing.indexOf(errors[0]!) < outgoing.indexOf(completes[0]!));
});

test("disconnect aborts a running turn", async () => {
  const agent = new FakeAgent();
  agent.run = () => new Promise<void>(() => {});
  const outgoing: Frame[] = [];
  const peer = new DosPeer((wire) => outgoing.push(decode(wire)));
  new LizaController(agent).attach(peer);

  peer.receive({ type: MessageType.SessionStart, sequence: 60, payload: Buffer.concat([Buffer.from([1]), Buffer.from("C:\\")]) });
  await settle();
  peer.receive({ type: MessageType.PromptChunk, sequence: 61, payload: Buffer.from("work") });
  peer.receive({ type: MessageType.PromptEnd, sequence: 61, payload: Buffer.alloc(0) });
  await settle();
  peer.receive({ type: MessageType.Disconnect, sequence: 62, payload: Buffer.alloc(0) });
  await settle();

  assert.ok(agent.aborted, "a running turn must be aborted when the client disconnects");
});
