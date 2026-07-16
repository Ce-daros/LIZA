import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ListFilesResult, ReadFileResult, WriteFileResult } from "./dos-peer.js";

export interface FileOperations {
  read(path: string, offset: number, maxBytes: number): Promise<ReadFileResult>;
  write(path: string, content: string, mode: "overwrite" | "append"): Promise<WriteFileResult>;
  writeBytes(path: string, content: Uint8Array, mode: "overwrite" | "append"): Promise<WriteFileResult>;
  list(path: string, pattern: string, cursor: number, limit: number): Promise<ListFilesResult>;
}

const dosPath = Type.String({ minLength: 1, maxLength: 67, description: "An MS-DOS path using drive letters and backslashes." });

export function createFileTools(operations: FileOperations) {
  const readFile = defineTool({
    name: "read_file",
    label: "Read DOS file",
    description: "Read a bounded text range from a file on the connected MS-DOS computer.",
    parameters: Type.Object({
      path: dosPath,
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 0x7fffffff, default: 0 })),
      max_bytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 16384, default: 4096 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const offset = params.offset ?? 0;
      const result = await operations.read(params.path, offset, params.max_bytes ?? 4096);
      return {
        content: [{
          type: "text" as const,
          text: [
            `Path: ${params.path}`,
            `Offset: ${offset}`,
            `Bytes read: ${Buffer.byteLength(result.content, "ascii")}`,
            `Next offset: ${result.nextOffset}`,
            `EOF: ${result.eof ? "yes" : "no"}`,
            "Content:",
            result.content,
          ].join("\n"),
        }],
        details: result,
      };
    },
  });

  const writeFile = defineTool({
    name: "write_file",
    label: "Write DOS file",
    description: "Stream text into a file on the connected MS-DOS computer without using COMMAND.COM or ECHO.",
    parameters: Type.Object({
      path: dosPath,
      content: Type.String({ maxLength: 32767 }),
      mode: Type.Union([Type.Literal("overwrite"), Type.Literal("append")]),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = await operations.write(params.path, params.content, params.mode);
      return {
        content: [{ type: "text" as const, text: `Path: ${params.path}\nMode: ${params.mode}\nBytes written: ${result.bytesWritten}` }],
        details: result,
      };
    },
  });

  const listFiles = defineTool({
    name: "list_files",
    label: "List DOS files",
    description: "List a page of files and directories on the connected MS-DOS computer using an 8.3 wildcard pattern.",
    parameters: Type.Object({
      path: dosPath,
      pattern: Type.Optional(Type.String({ minLength: 1, maxLength: 67, default: "*.*" })),
      cursor: Type.Optional(Type.Integer({ minimum: 0, maximum: 0xffff, default: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 50 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const pattern = params.pattern ?? "*.*";
      const cursor = params.cursor ?? 0;
      const result = await operations.list(params.path, pattern, cursor, params.limit ?? 50);
      return {
        content: [{
          type: "text" as const,
          text: [
            `Path: ${params.path}`,
            `Pattern: ${pattern}`,
            `Cursor: ${cursor}`,
            `Next cursor: ${result.nextCursor}`,
            `EOF: ${result.eof ? "yes" : "no"}`,
            "Entries (name, bytes, attributes, date, time):",
            result.entries,
          ].join("\n"),
        }],
        details: result,
      };
    },
  });

  return [readFile, writeFile, listFiles];
}
