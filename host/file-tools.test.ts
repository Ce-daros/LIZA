import assert from "node:assert/strict";
import test from "node:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createFileTools, type FileOperations } from "./file-tools.js";

interface TextBlock { type: "text"; text: string }

function stubOperations(overrides: Partial<FileOperations> = {}): FileOperations {
  const unused = async () => { throw new Error("unused"); };
  return {
    read: unused,
    write: unused,
    list: unused,
    ...overrides,
  };
}

async function invoke(tool: ToolDefinition, params: unknown): Promise<string> {
  const result = await tool.execute("call", params as never, undefined, undefined, undefined as never);
  const first = result.content[0] as TextBlock | undefined;
  assert.equal(first?.type, "text", "expected a text content block");
  return first!.text;
}

test("read_file renders path, defaults, byte length, offset, EOF flag, and content body", async () => {
  const tools = createFileTools(stubOperations({
    read: async () => ({ content: "hello\r\n", nextOffset: 7, eof: true }),
  }));

  const text = await invoke(tools[0], { path: "C:\\A.TXT" });

  assert.match(text, /^Path: C:\\A\.TXT$/m);
  assert.match(text, /^Offset: 0$/m);
  assert.match(text, /^Bytes read: 7$/m);
  assert.match(text, /^Next offset: 7$/m);
  assert.match(text, /^EOF: yes$/m);
  assert.match(text, /\nContent:\nhello\r\n$/);
});

test("read_file uses explicit offset and reports EOF=no", async () => {
  const tools = createFileTools(stubOperations({
    read: async (_path, offset, maxBytes) => ({
      content: "hi",
      nextOffset: offset + maxBytes,
      eof: false,
    }),
  }));

  const text = await invoke(tools[0], { path: "C:\\B.TXT", offset: 100, max_bytes: 256 });

  assert.match(text, /^Offset: 100$/m);
  assert.match(text, /^Bytes read: 2$/m);
  assert.match(text, /^Next offset: 356$/m);
  assert.match(text, /^EOF: no$/m);
});

test("write_file renders path, mode, and bytes written", async () => {
  const tools = createFileTools(stubOperations({
    write: async () => ({ bytesWritten: 1202 }),
  }));

  const text = await invoke(tools[1], { path: "C:\\STORY.TXT", content: "x".repeat(1202), mode: "overwrite" });

  assert.equal(text, "Path: C:\\STORY.TXT\nMode: overwrite\nBytes written: 1202");
});

test("list_files applies defaults, reports next cursor, EOF, and entries body", async () => {
  const tools = createFileTools(stubOperations({
    list: async () => ({
      entries: "STORY.TXT\t1202\t20\t2026-07-16\t12:00:00\r\n",
      nextCursor: 1,
      eof: true,
    }),
  }));

  const text = await invoke(tools[2], { path: "C:\\" });

  assert.match(text, /^Path: C:\\$/m);
  assert.match(text, /^Pattern: \*\.\*$/m);
  assert.match(text, /^Cursor: 0$/m);
  assert.match(text, /^Next cursor: 1$/m);
  assert.match(text, /^EOF: yes$/m);
  assert.match(text, /Entries \(name, bytes, attributes, date, time\):\nSTORY\.TXT/);
});

test("list_files passes through explicit pattern, cursor, and limit", async () => {
  let captured: { path: string; pattern: string; cursor: number; limit: number } | undefined;
  const tools = createFileTools(stubOperations({
    list: async (path, pattern, cursor, limit) => {
      captured = { path, pattern, cursor, limit };
      return { entries: "", nextCursor: cursor, eof: true };
    },
  }));

  await invoke(tools[2], { path: "D:\\GAMES", pattern: "*.EXE", cursor: 5, limit: 10 });

  assert.deepEqual(captured, { path: "D:\\GAMES", pattern: "*.EXE", cursor: 5, limit: 10 });
});