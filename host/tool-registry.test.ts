import assert from "node:assert/strict";
import test from "node:test";
import type { DosSessionPort } from "./agent-driver.js";
import { ClientMode } from "./protocol.js";
import { createLizaToolRegistry } from "./tool-registry.js";

test("completes search and fetch status without re-reading start arguments", () => {
  const registry = createLizaToolRegistry(inertPort());

  assert.deepEqual(registry.startStatus("tavily_search", { query: "recent news" }), {
    label: "SEARCH",
    detail: "recent news",
  });
  assert.deepEqual(registry.endStatus("tavily_search"), { label: "SEARCH" });
  assert.deepEqual(registry.startStatus("fetch_url", { url: "https://example.com" }), {
    label: "FETCH",
    detail: "https://example.com",
  });
  assert.deepEqual(registry.endStatus("fetch_url"), { label: "FETCH" });
});

test("run_python has no start detail but reports failure on non-zero exit or timeout", () => {
  const registry = createLizaToolRegistry(inertPort());

  const start = registry.startStatus("run_python", {});
  assert.equal(start?.label, "PYTHON");
  assert.equal(start?.detail, undefined);
  assert.deepEqual(registry.endStatus("run_python"), { label: "PYTHON" });

  assert.equal(
    registry.failed("run_python", { details: { exitCode: 0, timedOut: false } }, false),
    false,
    "successful run is not a failure",
  );
  assert.equal(
    registry.failed("run_python", { details: { exitCode: 1, timedOut: false } }, false),
    true,
    "non-zero exit code is a failure",
  );
  assert.equal(
    registry.failed("run_python", { details: { exitCode: 0, timedOut: true } }, false),
    true,
    "timeout is a failure",
  );
  assert.equal(
    registry.failed("run_python", { details: { exitCode: null, timedOut: false } }, false),
    true,
    "missing exit code is a failure",
  );
  assert.equal(
    registry.failed("run_python", { details: { exitCode: 0, timedOut: false } }, true),
    true,
    "any agent-level error short-circuits to failure",
  );
});

function inertPort(): DosSessionPort {
  const unavailable = async () => { throw new Error("unused"); };
  return {
    context: { mode: ClientMode.OneShot, cwd: "C:\\" },
    execute: unavailable,
    read: unavailable,
    write: unavailable,
    list: unavailable,
    reportToolStatus: () => {},
  };
}