import type { ClientMode } from "./protocol.js";
import type { ToolStatusState } from "./tool-status.js";

export interface PeerHandlers {
  onStart(mode: ClientMode, cwd: string): void | Promise<void>;
  onPrompt(sequence: number, prompt: string): void | Promise<void>;
  onCancel(sequence: number): void | Promise<void>;
  onNewSession(sequence: number): void | Promise<void>;
  onDisconnect(): void;
}

export interface ShellResult {
  output: string;
  exitCode: number;
  cwd: string;
  complete: boolean;
}

export interface ReadFileResult {
  content: string;
  nextOffset: number;
  eof: boolean;
}

export interface WriteFileResult {
  bytesWritten: number;
}

export interface ListFilesResult {
  entries: string;
  nextCursor: number;
  eof: boolean;
}

export type FrameWriter = (wire: Buffer) => void;

export type ToolStatusWireState = Exclude<ToolStatusState, "fail"> | "fail";
export type WriteFileMode = "overwrite" | "append";