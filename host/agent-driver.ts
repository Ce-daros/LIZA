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
  availableModels: readonly string[];
  availableEfforts: readonly string[];
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
  dispose(): void;
}
