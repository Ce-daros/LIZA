import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { createDosShellTool, DOS_FACING_TOOLS } from "./dos-tool.js";

test("registers the sequential, schema-constrained DOS shell tool", async () => {
  const calls: string[] = [];
  const tool = createDosShellTool(async (command) => {
    calls.push(command);
    return { output: "FILE.TXT\r\n", exitCode: 0, cwdBefore: "C:\\", cwd: "C:\\DOCS" };
  });

  assert.deepEqual(DOS_FACING_TOOLS, ["dos_shell", "read_file", "write_file", "list_files", "compile_c", "compile_asm"]);
  assert.equal(tool.name, "dos_shell");
  assert.equal(tool.executionMode, "sequential");
  assert.equal(Value.Check(tool.parameters, { command: "DIR" }), true);
  assert.equal(Value.Check(tool.parameters, { command: "" }), false);
  assert.equal(Value.Check(tool.parameters, { command: "X".repeat(127) }), false);
  assert.equal(Value.Check(tool.parameters, { command: "DIR", extra: true }), false);

  const result = await tool.execute("call-1", { command: "DIR" }, undefined as never, undefined as never, undefined as never);
  assert.deepEqual(calls, ["DIR"]);
  assert.equal(result.content[0]?.type, "text");
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Working directory before: C:\\/);
  assert.match(text, /Working directory after: C:\\DOCS/);
  assert.match(text, /Exit code: 0/);
  assert.match(text, /Output complete: yes\nOutput:\nFILE/);
});
