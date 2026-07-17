import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createPythonTool } from "./python-tool.js";

const pythonAvailable = spawnSync("python", ["--version"], { stdio: "ignore" }).status === 0;
const needsPython = { skip: !pythonAvailable };

test("runs Python source and reports stdout and the exit code", needsPython, async () => {
  const tool = createPythonTool();
  const result = await tool.execute("p-1", { source: "print(6 * 7)" }, undefined as never, undefined as never, undefined as never);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Exit code: 0/);
  assert.match(text, /Stdout:\n42/);
});

test("hides host environment variables from the snippet", needsPython, async () => {
  process.env.LIZA_TEST_SECRET = "secret";
  try {
    const tool = createPythonTool();
    const result = await tool.execute(
      "p-2",
      { source: "import os\nprint(os.environ.get(\"LIZA_TEST_SECRET\"))" },
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    assert.match(text, /Stdout:\nNone/);
  } finally {
    delete process.env.LIZA_TEST_SECRET;
  }
});

test("kills a snippet that exceeds its timeout", needsPython, async () => {
  const tool = createPythonTool();
  const result = await tool.execute(
    "p-3",
    { source: "import time\ntime.sleep(30)", timeout_seconds: 1 },
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Timed out after 1 second; the process was killed/);
});
