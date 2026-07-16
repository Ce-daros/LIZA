import assert from "node:assert/strict";
import test from "node:test";
import { buildLizaSystemPrompt } from "./personality.js";
import { ClientMode } from "./protocol.js";

test("builds authoritative DOS context without exposing the Windows host directory", () => {
  const prompt = buildLizaSystemPrompt({ mode: ClientMode.Interactive, cwd: "D:\\WORK" });
  assert.match(prompt, /Current drive: D:/);
  assert.match(prompt, /Current directory: D:\\WORK/);
  assert.match(prompt, /Client mode: interactive/);
  assert.match(prompt, /renders a compact Markdown subset/);
  assert.match(prompt, /fenced code blocks/);
  assert.doesNotMatch(prompt, /Users|Documents|Projects|LIZA\/host/i);
});
