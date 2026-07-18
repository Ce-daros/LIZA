import assert from "node:assert/strict";
import test from "node:test";
import { DosPeer } from "./dos-peer.js";
import { LizaDosSimulator } from "./dos-simulator.js";
import { ClientMode, encodeFrame, Frame, FrameDecoder, MessageType, TextStyle } from "./protocol.js";

function bindHostPeer(simulator: LizaDosSimulator): DosPeer {
  return new DosPeer((wire) => { simulator.send(wire); });
}

function sendFramesTo(simulator: LizaDosSimulator, peer: DosPeer, wires: Buffer[]): void {
  for (const wire of wires) {
    const sequence = wire.readUInt16LE(4);
    const payload = wire.subarray(8, wire.length - 2);
    peer.receive({ type: wire[3] as MessageType, sequence, payload });
  }
}

function encodeRaw(frame: Frame): Buffer {
  return encodeFrame(frame);
}

test("tool status: parses state byte, NUL-separated label and detail exactly as dos/liza.c does", () => {
  const simulator = new LizaDosSimulator();
  simulator.send(encodeFrame({
    type: MessageType.ToolStatus,
    sequence: 1,
    payload: Buffer.concat([Buffer.from([0]), Buffer.from("SEARCH"), Buffer.from([0]), Buffer.from("recent news")]),
  }));

  assert.equal(simulator.toolStatuses.length, 1);
  assert.deepEqual(simulator.toolStatuses[0], {
    state: "start",
    label: "SEARCH",
    detail: "recent news",
    rawLabelLength: 6,
    rawDetailLength: 11,
  });
});

test("tool status: truncates label at 15 bytes and detail at 80 bytes like the DOS C client", () => {
  const simulator = new LizaDosSimulator();
  const longLabel = "VERY_LONG_TOOL_LABEL";
  const longDetail = "x".repeat(150);

  simulator.send(encodeFrame({
    type: MessageType.ToolStatus,
    sequence: 1,
    payload: Buffer.concat([Buffer.from([0]), Buffer.from(longLabel), Buffer.from([0]), Buffer.from(longDetail)]),
  }));

  const status = simulator.toolStatuses[0]!;
  assert.equal(status.label.length, 15, "label is capped at 15 bytes to fit label[16]");
  assert.equal(status.label, longLabel.slice(0, 15));
  assert.equal(status.rawLabelLength, 20);
  assert.equal(status.detail.length, 80, "detail is capped at 80 bytes to match TERMINAL_WIDTH");
  assert.equal(status.detail, "x".repeat(80));
  assert.equal(status.rawDetailLength, 150);
});

test("tool status: parses 'ok' and 'fail' state bytes", () => {
  const simulator = new LizaDosSimulator();
  simulator.send(encodeFrame({
    type: MessageType.ToolStatus,
    sequence: 1,
    payload: Buffer.from([1, 0x50, 0x59, 0x54, 0x48, 0x4f, 0x4e, 0x00]),
  }));
  simulator.send(encodeFrame({
    type: MessageType.ToolStatus,
    sequence: 2,
    payload: Buffer.from([2, 0x50, 0x59, 0x54, 0x48, 0x4f, 0x4e, 0x00]),
  }));
  assert.equal(simulator.toolStatuses[0]?.state, "ok");
  assert.equal(simulator.toolStatuses[1]?.state, "fail");
});

test("tool status: detail may be omitted when label fills the payload", () => {
  const simulator = new LizaDosSimulator();
  simulator.send(encodeFrame({
    type: MessageType.ToolStatus,
    sequence: 1,
    payload: Buffer.from([0, 0x52, 0x45, 0x41, 0x44, 0x00]),
  }));
  assert.deepEqual(simulator.toolStatuses[0], {
    state: "start",
    label: "READ",
    detail: "",
    rawLabelLength: 4,
    rawDetailLength: 0,
  });
});

test("round trip: DosPeer.sendToolStatus wire bytes parse correctly on the DOS side", () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  peer.sendToolStatus(19, "start", "SEARCH", "recent news");
  peer.sendToolStatus(19, "ok", "SEARCH");
  peer.sendToolStatus(19, "fail", "SEARCH");

  assert.equal(simulator.toolStatuses.length, 3);
  assert.equal(simulator.toolStatuses[0]?.state, "start");
  assert.equal(simulator.toolStatuses[0]?.label, "SEARCH");
  assert.equal(simulator.toolStatuses[0]?.detail, "recent news");
  assert.equal(simulator.toolStatuses[1]?.state, "ok");
  assert.equal(simulator.toolStatuses[1]?.detail, "");
  assert.equal(simulator.toolStatuses[2]?.state, "fail");
});

test("round trip: tool status with long detail survives truncation on the DOS side", () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  peer.sendToolStatus(20, "start", "FETCH", "https://example.com/" + "x".repeat(120));

  const status = simulator.toolStatuses[0]!;
  assert.equal(status.label, "FETCH");
  assert.equal(status.detail.length, 80);
  assert.equal(status.rawDetailLength, 140);
});

test("HELLO: the simulator's Hello payload round-trips through the host's HelloAck", () => {
  const simulator = new LizaDosSimulator();
  const decoder = new FrameDecoder();
  const peer = new DosPeer((wire) => {
    const acks = decoder.push(wire);
    assert.equal(acks.length, 1);
    assert.equal(acks[0]!.type, MessageType.HelloAck);
    assert.equal(acks[0]!.sequence, 11);
    assert.equal(acks[0]!.payload.toString("ascii"), "LIZA-HOST/0.1");
  });
  peer.receive({ type: MessageType.Hello, sequence: 11, payload: Buffer.from("LIZA-DOS/0.1") });
});

test("session start: DOS payload of mode byte + cwd is what the host decodes", () => {
  const simulator = new LizaDosSimulator();
  simulator.send(encodeFrame({
    type: MessageType.SessionStart,
    sequence: 9,
    payload: Buffer.concat([Buffer.from([ClientMode.Interactive]), Buffer.from("C:\\DOS")]),
  }));

  assert.deepEqual(simulator.sessionStarts, [{ mode: ClientMode.Interactive, cwd: "C:\\DOS" }]);
});

test("prompts: chunks reassemble in sequence order regardless of arrival order", () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  const frames: { type: MessageType; sequence: number; payload: Buffer }[] = [
    { type: MessageType.PromptChunk, sequence: 50, payload: Buffer.from("find ") },
    { type: MessageType.PromptChunk, sequence: 50, payload: Buffer.from("the largest ") },
    { type: MessageType.PromptChunk, sequence: 50, payload: Buffer.from("file") },
    { type: MessageType.PromptEnd, sequence: 50, payload: Buffer.alloc(0) },
  ];
  for (const frame of frames) {
    peer.receive(frame);
    simulator.send(encodeRaw(frame));
  }

  assert.deepEqual(simulator.prompts, [{ sequence: 50, text: "find the largest file" }]);
});

test("prompts: long prompts split across many chunks reassemble in order", () => {
  const simulator = new LizaDosSimulator();
  const text = "x".repeat(2500);
  for (const wire of simulator.sendPrompt(7, text, 1024)) {
    simulator.send(wire);
  }

  assert.equal(simulator.prompts[0]?.text.length, 2500);
  assert.equal(simulator.prompts[0]?.text, text);
});

test("exec result: DOS-emitted chunks and ending resolve peer.execute() with exit code + cwd", async () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  const pending = peer.execute("DIR");
  sendFramesTo(simulator, peer, simulator.sendExecResult(1, [Buffer.from("ONE\r\n"), Buffer.from("TWO\r\n")], 0, "C:\\DOS"));
  assert.deepEqual(await pending, { output: "ONE\r\nTWO\r\n", exitCode: 0, cwd: "C:\\DOS" });
});

test("exec result: signed exit codes (e.g. -1) round-trip correctly", async () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  const pending = peer.execute("BAD");
  sendFramesTo(simulator, peer, simulator.sendExecResult(1, [Buffer.from("")], -1, "C:\\"));
  const result = await pending;
  assert.equal(result.exitCode, -1);
  assert.equal(result.cwd, "C:\\");
});

test("read result: 7-byte ending resolves peer.readFile() with status, offset, and EOF", async () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  const pending = peer.readFile("C:\\STORY.TXT", 10, 4096);
  sendFramesTo(simulator, peer, simulator.sendReadResult(1, [Buffer.from("hello\r\n")], 17, true));
  assert.deepEqual(await pending, { content: "hello\r\n", nextOffset: 17, eof: true });
});

test("write result: 6-byte ending resolves peer.writeFile() with bytes written", async () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  const pending = peer.writeFile("C:\\STORY.TXT", `${"A".repeat(600)}\n${"B".repeat(600)}`, "overwrite");
  sendFramesTo(simulator, peer, [simulator.sendWriteResult(1, 1202)]);
  assert.deepEqual(await pending, { bytesWritten: 1202 });
});

test("list result: 5-byte ending resolves peer.listFiles() with entries, cursor, EOF", async () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  const pending = peer.listFiles("C:\\", "*.TXT", 0, 20);
  sendFramesTo(simulator, peer, simulator.sendListResult(
    1,
    [Buffer.from("STORY.TXT\t1202\t20\t2026-07-16\t12:00:00\r\n")],
    1,
    true,
  ));
  const result = await pending;
  assert.equal(result.nextCursor, 1);
  assert.equal(result.eof, true);
  assert.match(result.entries, /STORY\.TXT/);
});

test("disconnect: peer.receive(Disconnect) flips isConnected to false after the inbound queue drains", async () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  assert.equal(peer.isConnected, true);
  peer.receive({ type: MessageType.Disconnect, sequence: 0, payload: Buffer.alloc(0) });
  await peer.whenInboundIdle();
  assert.equal(peer.isConnected, false);
});

test("disconnect: a Disconnect frame from DOS rejects any pending DOS command", async () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  const pending = peer.execute("DIR");
  peer.receive({ type: MessageType.Disconnect, sequence: 0, payload: Buffer.alloc(0) });
  await peer.whenInboundIdle();
  await assert.rejects(pending, /disconnected/);
});

test("errors: peer.sendError surface to the simulator with their sequence and message text", () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  peer.sendError(91, "DOS read failed with error 2");
  assert.deepEqual(simulator.errors, [{ sequence: 91, message: "DOS read failed with error 2" }]);
});

test("assistant streaming: peer.sendAssistant chunks concat to the full text on the DOS side", () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  peer.sendAssistant(60, "hello world");
  assert.deepEqual(simulator.assistant, [{ sequence: 60, text: "hello world" }]);
});

test("styled assistant: first byte is the style attribute, remainder is the text", () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  peer.sendStyledAssistant(70, TextStyle.Heading, "Title");
  peer.sendStyledAssistant(70, TextStyle.Emphasis, "italic");
  assert.deepEqual(simulator.styledAssistant, [
    { sequence: 70, style: TextStyle.Heading, text: "Title" },
    { sequence: 70, style: TextStyle.Emphasis, text: "italic" },
  ]);
});

test("complete: peer.sendComplete carries the prompt sequence", () => {
  const simulator = new LizaDosSimulator();
  const peer = bindHostPeer(simulator);
  peer.sendComplete(60);
  assert.deepEqual(simulator.completedSequences, [60]);
});

test("ping/pong: PING from DOS gets PONG with the same sequence back", () => {
  const simulator = new LizaDosSimulator();
  const decoder = new FrameDecoder();
  const peer = new DosPeer((wire) => {
    const responses = decoder.push(wire);
    assert.deepEqual(responses.map(({ type, sequence }) => [type, sequence]), [[MessageType.Pong, 0]]);
  });
  peer.receive({ type: MessageType.Ping, sequence: 0, payload: Buffer.alloc(0) });
});

test("protocol versions: simulator's clientId round-trips through the HELLO wire format", () => {
  const simulator = new LizaDosSimulator({ clientId: "LIZA-DOS/0.9" });
  const wire = simulator.sendHello();
  const sequence = wire.readUInt16LE(4);
  const payload = wire.subarray(8, wire.length - 2);
  assert.equal(wire[3], MessageType.Hello);
  assert.equal(sequence, 1);
  assert.equal(payload.toString("ascii"), "LIZA-DOS/0.9");
});

test("sequence numbers: simulator allocates monotonic sequences and skips zero", () => {
  const simulator = new LizaDosSimulator();
  const a = simulator.sendHello();
  const b = simulator.sendHello();
  const c = simulator.sendHello();
  assert.equal(a.readUInt16LE(4), 1);
  assert.equal(b.readUInt16LE(4), 2);
  assert.equal(c.readUInt16LE(4), 3);
});