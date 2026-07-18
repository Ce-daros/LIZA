import assert from "node:assert/strict";
import test from "node:test";
import { encodeDosPath, toDosAscii } from "./dos-ascii.js";

test("toDosAscii transliterates supported punctuation and drops unsupported characters for DOS", () => {
  assert.equal(toDosAscii("It\u2019s \u2014 \u201chello\u201d\u2026 \u2192 \u2026 \ud83d\udea8"), "It's - \"hello\"... -> ... ");
});

test("toDosAscii normalizes CRLF / CR to LF", () => {
  assert.equal(toDosAscii("a\r\nb\rc"), "a\nb\nc");
});

test("encodeDosPath rejects empty or over-long paths after transliteration", () => {
  assert.throws(() => encodeDosPath(""), /1 to 67 bytes/);
  assert.throws(() => encodeDosPath("x".repeat(68)), /1 to 67 bytes/);
});

test("encodeDosPath passes through a normal DOS path", () => {
  assert.equal(encodeDosPath("C:\\DOS\\README.TXT").toString("ascii"), "C:\\DOS\\README.TXT");
});