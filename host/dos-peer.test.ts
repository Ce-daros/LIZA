import assert from "node:assert/strict";
import test from "node:test";
import { DosPeer, toDosAscii } from "./dos-peer.js";
import { ClientMode, encodeExitCode, Frame, FrameDecoder, MessageType } from "./protocol.js";

function decodeWire(wire: Buffer): Frame {
  const frames = new FrameDecoder().push(wire);
  assert.equal(frames.length, 1);
  return frames[0]!;
}

test("handshakes, starts a session, and assembles a chunked prompt", () => {
  const sent: Frame[] = [];
  const peer = new DosPeer((wire) => sent.push(decodeWire(wire)));
  let start: [ClientMode, string] | undefined;
  let prompt: [number, string] | undefined;
  peer.setHandlers({
    onStart: (mode, cwd) => { start = [mode, cwd]; },
    onPrompt: (sequence, text) => { prompt = [sequence, text]; },
    onCancel: () => {},
    onNewSession: () => {},
    onDisconnect: () => {},
  });

  peer.receive({ type: MessageType.Hello, sequence: 4, payload: Buffer.from("LIZA-DOS/0.1") });
  peer.receive({ type: MessageType.Ping, sequence: 0, payload: Buffer.alloc(0) });
  peer.receive({ type: MessageType.SessionStart, sequence: 5, payload: Buffer.concat([Buffer.from([ClientMode.OneShot]), Buffer.from("C:\\DOS")]) });
  peer.receive({ type: MessageType.PromptChunk, sequence: 6, payload: Buffer.from("largest ") });
  peer.receive({ type: MessageType.PromptChunk, sequence: 6, payload: Buffer.from("file") });
  peer.receive({ type: MessageType.PromptEnd, sequence: 6, payload: Buffer.alloc(0) });

  assert.deepEqual(start, [ClientMode.OneShot, "C:\\DOS"]);
  assert.deepEqual(prompt, [6, "largest file"]);
  assert.deepEqual(sent.map((frame) => [frame.type, frame.sequence]), [
    [MessageType.HelloAck, 4],
    [MessageType.Pong, 0],
    [MessageType.SessionReady, 5],
  ]);
});

test("streams a DOS command result back to one pending execution", async () => {
  let peer: DosPeer;
  peer = new DosPeer((wire) => {
    const request = decodeWire(wire);
    assert.equal(request.type, MessageType.ExecRequest);
    assert.equal(request.payload.toString("ascii"), "DIR");
    peer.receive({ type: MessageType.ExecResultChunk, sequence: request.sequence, payload: Buffer.from("ONE\r\n") });
    peer.receive({ type: MessageType.ExecResultChunk, sequence: request.sequence, payload: Buffer.from("TWO\r\n") });
    peer.receive({
      type: MessageType.ExecResultEnd,
      sequence: request.sequence,
      payload: Buffer.concat([encodeExitCode(0), Buffer.from("C:\\DOS")]),
    });
  });

  assert.deepEqual(await peer.execute("DIR"), { output: "ONE\r\nTWO\r\n", exitCode: 0, cwd: "C:\\DOS" });
  assert.throws(() => peer.execute("X".repeat(127)), /1 to 126/);
});

test("rejects an active command when DOS disconnects", async () => {
  const peer = new DosPeer(() => {});
  const pending = peer.execute("DIR");
  peer.receive({ type: MessageType.Disconnect, sequence: 9, payload: Buffer.alloc(0) });
  await assert.rejects(pending, /disconnected during command execution/);
});

test("chunks long assistant output and routes cancellation", () => {
  const sent: Frame[] = [];
  const peer = new DosPeer((wire) => sent.push(decodeWire(wire)));
  let cancelled = 0;
  peer.setHandlers({
    onStart: () => {},
    onPrompt: () => {},
    onCancel: (sequence) => { cancelled = sequence; },
    onNewSession: () => {},
    onDisconnect: () => {},
  });
  const text = `${"A".repeat(2300)} LIZA\u2019s`;
  peer.sendAssistant(71, text);
  peer.receive({ type: MessageType.Cancel, sequence: 71, payload: Buffer.alloc(0) });

  assert.equal(cancelled, 71);
  assert.deepEqual(sent.map((frame) => frame.payload.length), [1024, 1024, 259]);
  assert.equal(Buffer.concat(sent.map((frame) => frame.payload)).toString("ascii"), `${"A".repeat(2300)} LIZA's`);
});

test("transliterates common model punctuation for DOS", () => {
  assert.equal(toDosAscii("It\u2019s \u2014 \u201chello\u201d\u2026 \u2192 \u2022"), "It's - \"hello\"... -> *");
});

test("streams bounded DOS file reads", async () => {
  let peer: DosPeer;
  peer = new DosPeer((wire) => {
    const request = decodeWire(wire);
    assert.equal(request.type, MessageType.ReadFileRequest);
    assert.equal(request.payload.readUInt32LE(0), 10);
    assert.equal(request.payload.readUInt16LE(4), 4096);
    assert.equal(request.payload.subarray(6).toString("ascii"), "C:\\STORY.TXT");
    peer.receive({ type: MessageType.ReadFileChunk, sequence: request.sequence, payload: Buffer.from("hello\r\n") });
    const ending = Buffer.alloc(7);
    ending.writeUInt32LE(17, 2);
    ending[6] = 1;
    peer.receive({ type: MessageType.ReadFileEnd, sequence: request.sequence, payload: ending });
  });
  assert.deepEqual(await peer.readFile("C:\\STORY.TXT", 10, 4096), {
    content: "hello\r\n",
    nextOffset: 17,
    eof: true,
  });
});

test("chunks DOS file writes and receives the byte count", async () => {
  const sent: Frame[] = [];
  let peer: DosPeer;
  peer = new DosPeer((wire) => {
    const frame = decodeWire(wire);
    sent.push(frame);
    if (frame.type === MessageType.WriteFileEnd) {
      const result = Buffer.alloc(6);
      result.writeUInt32LE(1202, 2);
      peer.receive({ type: MessageType.WriteFileResult, sequence: frame.sequence, payload: result });
    }
  });
  assert.deepEqual(await peer.writeFile("C:\\STORY.TXT", `${"A".repeat(600)}\n${"B".repeat(600)}`, "overwrite"), {
    bytesWritten: 1202,
  });
  assert.deepEqual(sent.map((frame) => frame.type), [
    MessageType.WriteFileStart,
    MessageType.WriteFileChunk,
    MessageType.WriteFileChunk,
    MessageType.WriteFileChunk,
    MessageType.WriteFileEnd,
  ]);
  assert.deepEqual(sent.filter((frame) => frame.type === MessageType.WriteFileChunk).map((frame) => frame.payload.length), [512, 512, 178]);
});

test("returns a paginated DOS directory listing", async () => {
  let peer: DosPeer;
  peer = new DosPeer((wire) => {
    const request = decodeWire(wire);
    assert.equal(request.type, MessageType.ListFilesRequest);
    peer.receive({ type: MessageType.ListFilesChunk, sequence: request.sequence, payload: Buffer.from("STORY.TXT\t1202\t20\t2026-07-16\t12:00:00\r\n") });
    const ending = Buffer.alloc(5);
    ending.writeUInt16LE(1, 2);
    ending[4] = 1;
    peer.receive({ type: MessageType.ListFilesEnd, sequence: request.sequence, payload: ending });
  });
  const result = await peer.listFiles("C:\\", "*.TXT", 0, 20);
  assert.match(result.entries, /STORY\.TXT/);
  assert.equal(result.nextCursor, 1);
  assert.equal(result.eof, true);
});
