import assert from "node:assert/strict";
import test from "node:test";
import { buildLizaSystemPrompt } from "./personality.js";
import { ClientMode } from "./protocol.js";

test("builds authoritative DOS context without exposing the Windows host directory", () => {
  const prompt = buildLizaSystemPrompt({ mode: ClientMode.Interactive, cwd: "D:\\WORK" });
  assert.match(prompt, /Current drive: D:/);
  assert.match(prompt, /Current directory: D:\\WORK/);
  assert.match(prompt, /Client mode: interactive/);
  assert.match(prompt, /retrofuturist/);
  assert.match(prompt, /Make the user feel accompanied at the keyboard/);
  assert.match(prompt, /Never narrate actions or roleplay with asterisks/);
  assert.match(prompt, /Use it flexibly to make important ideas feel clear and alive/);
  assert.match(prompt, /Use tavily_search when the user needs timely/);
  assert.match(prompt, /must call tavily_search instead of claiming that you lack a modem/);
  assert.match(prompt, /Host local date and time:/);
  assert.match(prompt, /Windows host's local clock/);
  assert.match(prompt, /Never substitute compile_asm after a failed compile_c call/);
  assert.match(prompt, /renders a compact Markdown subset/);
  assert.match(prompt, /fenced code blocks/);
  assert.doesNotMatch(prompt, /Users|Documents|Projects|LIZA\/host/i);
});
