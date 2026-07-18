import assert from "node:assert/strict";
import test from "node:test";
import { buildExecRequest, buildListFilesRequest, buildReadFileRequest, buildWriteFileStart, writeListCursorAndLimit } from "./dos-peer-payload.js";

test("buildExecRequest encodes the command as ASCII", () => {
  assert.equal(buildExecRequest("DIR *.TXT").toString("ascii"), "DIR *.TXT");
});

test("buildReadFileRequest lays out offset, maxBytes, and path with the right widths", () => {
  const payload = buildReadFileRequest("C:\\STORY.TXT", 10, 4096);
  assert.equal(payload.readUInt32LE(0), 10);
  assert.equal(payload.readUInt16LE(4), 4096);
  assert.equal(payload.subarray(6).toString("ascii"), "C:\\STORY.TXT");
});

test("buildReadFileRequest propagates range errors from encodeDosPath", () => {
  assert.throws(() => buildReadFileRequest("", 0, 1), /1 to 67 bytes/);
  assert.throws(() => buildReadFileRequest("x".repeat(68), 0, 1), /1 to 67 bytes/);
});

test("buildWriteFileStart uses byte 1 for overwrite and 2 for append, then the path", () => {
  const overwrite = buildWriteFileStart("C:\\A.TXT", "overwrite");
  assert.equal(overwrite[0], 1);
  assert.equal(overwrite.subarray(1).toString("ascii"), "C:\\A.TXT");

  const append = buildWriteFileStart("C:\\A.TXT", "append");
  assert.equal(append[0], 2);
  assert.equal(append.subarray(1).toString("ascii"), "C:\\A.TXT");
});

test("buildListFilesRequest puts the directory length byte at offset 3", () => {
  const payload = buildListFilesRequest("C:\\", "*.*");
  assert.equal(payload[3], 3, "directory length is exactly the byte length of 'C:\\\\'");
  assert.equal(payload.subarray(4, 7).toString("ascii"), "C:\\");
  assert.equal(payload.subarray(7).toString("ascii"), "*.*");
});

test("writeListCursorAndLimit writes cursor (16-bit) at offset 0 and limit (1 byte) at offset 2", () => {
  const payload = buildListFilesRequest("C:\\", "*.*");
  writeListCursorAndLimit(payload, 7, 50);
  assert.equal(payload.readUInt16LE(0), 7);
  assert.equal(payload[2], 50);
});