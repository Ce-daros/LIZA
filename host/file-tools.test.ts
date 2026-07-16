import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { createFileTools } from "./file-tools.js";

test("defines bounded sequential DOS file tools", async () => {
  const tools = createFileTools({
    read: async () => ({ content: "hello", nextOffset: 5, eof: true }),
    write: async () => ({ bytesWritten: 5 }),
    writeBytes: async () => ({ bytesWritten: 5 }),
    list: async () => ({ entries: "A.TXT\t5\t20\t2026-07-16\t12:00:00\r\n", nextCursor: 1, eof: true }),
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["read_file", "write_file", "list_files"]);
  assert.deepEqual(tools.map((tool) => tool.executionMode), ["sequential", "sequential", "sequential"]);

  const read = tools[0]!;
  const write = tools[1]!;
  const list = tools[2]!;
  assert.equal(Value.Check(read.parameters, { path: "C:\\A.TXT" }), true);
  assert.equal(Value.Check(read.parameters, { path: "C:\\A.TXT", max_bytes: 20000 }), false);
  assert.equal(Value.Check(write.parameters, { path: "C:\\A.TXT", content: "hello", mode: "overwrite" }), true);
  assert.equal(Value.Check(write.parameters, { path: "C:\\A.TXT", content: "hello", mode: "create" }), false);
  assert.equal(Value.Check(list.parameters, { path: "C:\\", pattern: "*.TXT", limit: 51 }), false);

  const result = await read.execute("read-1", { path: "C:\\A.TXT" }, undefined as never, undefined as never, undefined as never);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Next offset: 5/);
  assert.match(text, /EOF: yes/);
});
