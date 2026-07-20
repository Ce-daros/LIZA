import assert from "node:assert/strict";
import test from "node:test";
import { decodeExitCode, encodeFrame, FrameDecoder, MessageType, splitPayload } from "./protocol.js";
import { encodeExitCode } from "./dos-simulator.js";

const helloHex = "4c5a010101000c004c495a412d444f532f302e314068";
const textHex = "4c5a01030200050068656c6c6f2bc1";

test("encodes the fixed protocol examples", () => {
  assert.equal(encodeFrame({ type: MessageType.Hello, sequence: 1, payload: Buffer.from("LIZA-DOS/0.1") }).toString("hex"), helloHex);
  assert.equal(encodeFrame({ type: MessageType.Text, sequence: 2, payload: Buffer.from("hello") }).toString("hex"), textHex);
});

test("decodes a frame split at every byte boundary", () => {
  const decoder = new FrameDecoder();
  const wire = Buffer.from(textHex, "hex");
  const frames = [];
  for (const byte of wire) frames.push(...decoder.push(Buffer.of(byte)));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.payload.toString(), "hello");
});

test("decodes adjacent frames in one read", () => {
  const decoder = new FrameDecoder();
  const frames = decoder.push(Buffer.from(helloHex + textHex, "hex"));
  assert.deepEqual(frames.map(({ type, sequence }) => [type, sequence]), [[MessageType.Hello, 1], [MessageType.Text, 2]]);
});

test("resynchronizes after garbage, an invalid length, and a bad CRC", () => {
  const decoder = new FrameDecoder();
  const invalidLength = Buffer.from("4c5a010300000104", "hex");
  const badCrc = Buffer.from(textHex, "hex");
  badCrc[badCrc.length - 1] = badCrc[badCrc.length - 1]! ^ 0xff;
  const valid = Buffer.from(textHex, "hex");
  const frames = decoder.push(Buffer.concat([Buffer.from("garbage"), invalidLength, badCrc, valid]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.payload.toString(), "hello");
});

test("keeps last byte if it matches SYNC[0] when no sync found", () => {
  const decoder = new FrameDecoder();
  const partial = Buffer.from([0x4c]);
  const frames = decoder.push(partial);
  assert.equal(frames.length, 0);
  assert.equal(decoder["buffer"].length, 1);
  assert.equal(decoder["buffer"][0], 0x4c);
});

test("discards buffer when last byte is not SYNC[0]", () => {
  const decoder = new FrameDecoder();
  const garbage = Buffer.from([0x00, 0x01, 0x02]);
  const frames = decoder.push(garbage);
  assert.equal(frames.length, 0);
  assert.equal(decoder["buffer"].length, 0);
});

test("keeps last byte as potential sync when byte matches SYNC[0] but buffer too short for header", () => {
  const decoder = new FrameDecoder();
  const partial = Buffer.from([0x4c, 0x5a, 0x01]);
  const frames = decoder.push(partial);
  assert.equal(frames.length, 0);
  assert.equal(decoder["buffer"].length, 3);
});

test("splits long logical payloads without empty trailing chunks", () => {
  const chunks = splitPayload(Buffer.alloc(2500, 0x41), 1000);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [1000, 1000, 500]);
  assert.deepEqual(splitPayload(Buffer.alloc(0)), []);
});

test("encodes signed DOS exit codes", () => {
  assert.equal(decodeExitCode(encodeExitCode(0)), 0);
  assert.equal(decodeExitCode(encodeExitCode(255)), 255);
  assert.equal(decodeExitCode(encodeExitCode(-1)), -1);
});
