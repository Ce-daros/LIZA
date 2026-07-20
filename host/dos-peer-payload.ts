import { encodeDosPath } from "./dos-ascii.js";

export function buildExecRequest(command: string): Buffer {
  return Buffer.from(command, "ascii");
}

export function buildReadFileRequest(path: string, offset: number, maxBytes: number): Buffer {
  const filePath = encodeDosPath(path);
  const payload = Buffer.alloc(6 + filePath.length);
  payload.writeUInt32LE(offset, 0);
  payload.writeUInt16LE(maxBytes, 4);
  filePath.copy(payload, 6);
  return payload;
}

export function buildWriteFileStart(path: string, mode: "overwrite" | "append"): Buffer {
  const filePath = encodeDosPath(path);
  return Buffer.concat([Buffer.from([mode === "overwrite" ? 1 : 2]), filePath]);
}

export function buildListFilesRequest(path: string, pattern: string): Buffer {
  const directory = encodeDosPath(path);
  const mask = encodeDosPath(pattern);
  const payload = Buffer.alloc(4 + directory.length + mask.length);
  payload[3] = directory.length;
  directory.copy(payload, 4);
  mask.copy(payload, 4 + directory.length);
  return payload;
}

export function writeListCursorAndLimit(payload: Buffer, cursor: number, limit: number): void {
  payload.writeUInt16LE(cursor, 0);
  payload[2] = limit;
}