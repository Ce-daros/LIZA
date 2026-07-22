import type { ShellResult } from "./dos-peer.js";
import type { FileOperations } from "./file-tools.js";
import type { DosContext } from "./dos-context-prompt.js";
import type { ToolStatusReporter } from "./tool-status.js";

export interface DosSessionPort extends FileOperations {
  context: DosContext;
  execute(command: string): Promise<ShellResult>;
  reportToolStatus: ToolStatusReporter;
}

export interface AgentStatus {
  model: string;
  effort: string;
  sessionId: string;
  sessionName: string | undefined;
  availableModels: readonly string[];
  availableEfforts: readonly string[];
}

export interface SavedSession {
  id: string;
  name: string | undefined;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string;
  active: boolean;
}

export interface AgentDriver {
  connect(port: DosSessionPort): Promise<void>;
  disconnect(): void;
  getStatus(): AgentStatus;
  setModel(alias: string): Promise<AgentStatus>;
  setEffort(effort: string): AgentStatus;
  run(prompt: string, onText: (text: string) => void): Promise<void>;
  abort(): Promise<void>;
  newSession(): Promise<void>;
  listSessions(): Promise<readonly SavedSession[]>;
  resumeSession(id: string): Promise<SavedSession>;
  renameSession(name: string): void;
  deleteSession(id: string): Promise<void>;
  exportSession(): string;
  dispose(): void;
}
