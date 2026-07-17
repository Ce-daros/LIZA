import assert from "node:assert/strict";
import test from "node:test";
import { createFileTools } from "./file-tools.js";

test("formats a DOS file read result with offset and EOF markers", async () => {
  const tools = createFileTools({
    read: async () => ({ content: "hello", nextOffset: 5, eof: true }),
    write: async () => ({ bytesWritten: 5 }),
    writeBytes: async () => ({ bytesWritten: 5 }),
    list: async () => ({ entries: "A.TXT\t5\t20\t2026-07-16\t12:00:00\r\n", nextCursor: 1, eof: true }),
  });

  const result = await tools[0]!.execute("read-1", { path: "C:\\A.TXT" }, undefined as never, undefined as never, undefined as never);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Next offset: 5/);
  assert.match(text, /EOF: yes/);
});
