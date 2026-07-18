import assert from "node:assert/strict";
import test from "node:test";
import { buildDosContextPrompt, type DosContext } from "./dos-context-prompt.js";
import { LIZA_PERSONALITY } from "./personality.js";
import { LIZA_RESPONSE_RULES } from "./response-rules.js";
import { buildLizaSystemPrompt } from "./system-prompt.js";
import { ClientMode } from "./protocol.js";
import { buildToolPrompt, type ToolPromptEntry } from "./tool-prompt.js";

test("buildDosContextPrompt maps one-shot mode and derives drive letter", () => {
  const prompt = buildDosContextPrompt({ mode: ClientMode.OneShot, cwd: "C:\\DOS" });
  assert.match(prompt, /Client mode: one-shot/);
  assert.match(prompt, /Current drive: C:/);
  assert.match(prompt, /Current directory: C:\\DOS/);
});

test("buildDosContextPrompt maps interactive mode and uses uppercase drive", () => {
  const prompt = buildDosContextPrompt({ mode: ClientMode.Interactive, cwd: "D:\\GAMES\\DOOM" });
  assert.match(prompt, /Client mode: interactive/);
  assert.match(prompt, /Current drive: D:/);
  assert.match(prompt, /Current directory: D:\\GAMES\\DOOM/);
});

test("buildDosContextPrompt reports unknown drive for non-DOS paths", () => {
  assert.match(buildDosContextPrompt({ mode: ClientMode.Interactive, cwd: "/unix/path" }),
    /Current drive: unknown/);
  assert.match(buildDosContextPrompt({ mode: ClientMode.Interactive, cwd: "" }),
    /Current drive: unknown/);
  assert.match(buildDosContextPrompt({ mode: ClientMode.Interactive, cwd: "C" }),
    /Current drive: unknown/);
});

test("buildDosContextPrompt locks DOS contract text and host-clock disclaimer", () => {
  const prompt = buildDosContextPrompt({ mode: ClientMode.OneShot, cwd: "C:\\" });
  assert.match(prompt, /DOS environment for this invocation:/);
  assert.match(prompt, /This is the Windows host's local clock, not the DOS clock/);
  assert.match(prompt, /Shell: COMMAND\.COM-compatible MS-DOS 6\.22 shell/);
  assert.match(prompt, /Display: 80x25 VGA text mode/);
  assert.match(prompt, /Maximum command line: 126 bytes/);
  assert.match(prompt, /CD, drive, and SET changes persist only until this LIZA invocation exits/);
  assert.match(prompt, /This DOS environment is authoritative\. Never treat a Windows host path as a DOS path\./);
  assert.match(prompt, /The exit code and updated DOS directory returned by each dos_shell call supersede earlier values\./);
  assert.match(prompt, /DO NOT KEEP TELLING USER THE CURRENT FOLDER\. User can see it\./);
});

test("buildToolPrompt formats entries as a list with a final warning", () => {
  const entries: ToolPromptEntry[] = [
    { name: "dos_shell", instruction: "Run commands." },
    { name: "read_file", instruction: "Read files." },
  ];
  const prompt = buildToolPrompt(entries);
  assert.equal(prompt.split("\n")[0], "Active sequential tools:");
  assert.match(prompt, /^- dos_shell: Run commands\.$/m);
  assert.match(prompt, /^- read_file: Read files\.$/m);
  assert.match(prompt, /Do not claim to have read, written, listed, searched, fetched, or inspected anything unless you used the corresponding tool\./);
  assert.match(prompt, /If an operation fails, correct it or explain the failure briefly\./);
});

test("buildToolPrompt renders an empty list without crashing", () => {
  const prompt = buildToolPrompt([]);
  assert.match(prompt, /^Active sequential tools:\n\n/);
});

test("buildLizaSystemPrompt joins personality, rules, tools, and context in that order with blank-line separators", () => {
  const context: DosContext = { mode: ClientMode.OneShot, cwd: "C:\\WORK" };
  const tools: ToolPromptEntry[] = [{ name: "dos_shell", instruction: "Run commands." }];
  const prompt = buildLizaSystemPrompt(context, tools);

  assert.ok(prompt.startsWith(LIZA_PERSONALITY), "prompt must start with the personality");
  assert.ok(prompt.includes(LIZA_RESPONSE_RULES), "prompt must contain the response rules");
  assert.ok(prompt.includes("Active sequential tools:\n- dos_shell: Run commands."));
  assert.ok(prompt.includes("DOS environment for this invocation:"));
  assert.ok(prompt.includes("Client mode: one-shot"));
  assert.ok(prompt.includes("Current drive: C:"));

  const personalityIndex = prompt.indexOf(LIZA_PERSONALITY);
  const rulesIndex = prompt.indexOf(LIZA_RESPONSE_RULES);
  const toolsIndex = prompt.indexOf("Active sequential tools:");
  const contextIndex = prompt.indexOf("DOS environment for this invocation:");
  assert.ok(personalityIndex < rulesIndex, "personality must come before rules");
  assert.ok(rulesIndex < toolsIndex, "rules must come before tools");
  assert.ok(toolsIndex < contextIndex, "tools must come before context");

  const expectedSeparator = `\n\n${LIZA_RESPONSE_RULES}\n\n`;
  assert.ok(prompt.includes(expectedSeparator), "sections must be separated by blank lines");
});

test("buildLizaSystemPrompt reflects updated context on each call", () => {
  const tools: ToolPromptEntry[] = [];
  const a = buildLizaSystemPrompt({ mode: ClientMode.Interactive, cwd: "A:\\" }, tools);
  const b = buildLizaSystemPrompt({ mode: ClientMode.OneShot, cwd: "B:\\" }, tools);
  assert.match(a, /Client mode: interactive/);
  assert.match(a, /Current drive: A:/);
  assert.match(b, /Client mode: one-shot/);
  assert.match(b, /Current drive: B:/);
  assert.notEqual(a, b);
});