import assert from "node:assert/strict";
import test from "node:test";
import { createDosShellTool, type DosShellResult } from "./dos-tool.js";

function stubExecute(results: Record<string, DosShellResult>) {
  const calls: string[] = [];
  const execute = async (command: string): Promise<DosShellResult> => {
    calls.push(command);
    const next = results[command] ?? results["*"];
    if (!next) throw new Error(`stubExecute: no stub for ${command}`);
    return next;
  };
  return { execute, calls };
}

async function invoke(tool: ReturnType<typeof createDosShellTool>, command: string): Promise<string> {
  const result = await tool.execute("c-1", { command }, undefined as never, undefined as never, undefined as never);
  const first = result.content[0];
  assert.equal(first?.type, "text", "expected a text content block");
  return (first as { type: "text"; text: string }).text;
}

test("dos_shell renders command, cwd before/after, exit code, and complete flag", async () => {
  const { execute, calls } = stubExecute({
    "DIR *.TXT": { output: "NOTES.TXT 18432\r\n", exitCode: 0, cwd: "C:\\DOS", cwdBefore: "C:\\" },
  });
  const tool = createDosShellTool(execute);

  const text = await invoke(tool, "DIR *.TXT");
  assert.deepEqual(calls, ["DIR *.TXT"]);
  assert.match(text, /^Command: DIR \*\.TXT$/m);
  assert.match(text, /^Working directory before: C:\\$/m);
  assert.match(text, /^Working directory after: C:\\DOS$/m);
  assert.match(text, /^Exit code: 0$/m);
  assert.match(text, /^Output complete: yes$/m);
  assert.match(text, /\nOutput:\nNOTES\.TXT 18432\r\n$/);
});

test("dos_shell reports non-zero exit codes verbatim", async () => {
  const { execute } = stubExecute({
    "*": { output: "File not found\r\n", exitCode: 2, cwd: "C:\\", cwdBefore: "C:\\" },
  });
  const tool = createDosShellTool(execute);

  const text = await invoke(tool, "BAD");
  assert.match(text, /^Exit code: 2$/m);
  assert.match(text, /^Output complete: yes$/m);
  assert.match(text, /\nOutput:\nFile not found\r\n$/);
});

test("dos_shell omits output section when the captured output is empty", async () => {
  const { execute } = stubExecute({
    "*": { output: "", exitCode: 0, cwd: "C:\\", cwdBefore: "C:\\" },
  });
  const tool = createDosShellTool(execute);

  const text = await invoke(tool, "CD WORK");
  assert.match(text, /^Output complete: yes$/m);
  assert.match(text, /\nOutput:\n$/);
  assert.doesNotMatch(text, /\r\n/);
});

test("dos_shell surfaces executor errors with the command and message", async () => {
  const execute = async () => { throw new Error("serial port closed"); };
  const tool = createDosShellTool(execute);
  await assert.rejects(invoke(tool, "DIR"), /serial port closed/);
});