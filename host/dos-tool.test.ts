import assert from "node:assert/strict";
import test from "node:test";
import { createDosShellTool } from "./dos-tool.js";

test("formats the shell result with working directories and exit code", async () => {
  const calls: string[] = [];
  const tool = createDosShellTool(async (command) => {
    calls.push(command);
    return { output: "FILE.TXT\r\n", exitCode: 0, cwdBefore: "C:\\", cwd: "C:\\DOCS" };
  });

  const result = await tool.execute("call-1", { command: "DIR" }, undefined as never, undefined as never, undefined as never);
  assert.deepEqual(calls, ["DIR"]);
  assert.equal(result.content[0]?.type, "text");
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Working directory before: C:\\/);
  assert.match(text, /Working directory after: C:\\DOCS/);
  assert.match(text, /Exit code: 0/);
  assert.match(text, /Output complete: yes\nOutput:\nFILE/);
});
