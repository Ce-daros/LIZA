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

function inertPort(): DosSessionPort {
  const unavailable = async () => { throw new Error("unused"); };
  return {
    context: { mode: ClientMode.OneShot, cwd: "C:\\" },
    execute: unavailable,
    read: unavailable,
    write: unavailable,
    writeBytes: unavailable,
    list: unavailable,
    reportToolStatus: () => {},
  };
}
