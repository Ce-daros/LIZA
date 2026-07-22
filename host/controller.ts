import { ClientMode } from "./protocol.js";
import { DosPeer } from "./dos-peer.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import type { AgentDriver, DosSessionPort } from "./agent-driver.js";

export class LizaController {
  private activePeer: DosPeer | undefined;
  private activeSequence: number | undefined;
  private renderer: MarkdownRenderer | undefined;
  private running = false;
  private cancelRequested = false;

  constructor(private readonly agent: AgentDriver) {}

  attach(peer: DosPeer): void {
    this.activePeer = peer;
    peer.setHandlers({
      onStart: (mode, cwd) => this.onStart(peer, mode, cwd),
      onPrompt: (sequence, prompt) => this.onPrompt(peer, sequence, prompt),
      onCancel: (sequence) => this.onCancel(peer, sequence),
      onNewSession: (sequence) => this.onNewSession(peer, sequence),
      onDisconnect: () => this.onDisconnect(peer),
    });
  }

  dispose(): void {
    this.agent.dispose();
  }

  private async onStart(peer: DosPeer, mode: ClientMode, cwd: string): Promise<void> {
    await this.agent.connect(this.createSessionPort(peer, { mode, cwd }));
    const label = mode === ClientMode.OneShot ? "one-shot" : "interactive";
    console.log(`[dos] ${label} session at ${cwd}`);
  }

  private async onPrompt(peer: DosPeer, sequence: number, prompt: string): Promise<void> {
    if (this.running) {
      this.respond(peer, sequence, "LIZA is already processing a request", true);
      return;
    }
    let commandResult: string | undefined;
    try {
      commandResult = await this.tryHandleSlashCommand(peer, prompt);
    } catch (error) {
      this.respond(peer, sequence, error instanceof Error ? error.message : String(error), true);
      return;
    }
    if (commandResult !== undefined) {
      this.respond(peer, sequence, commandResult);
      return;
    }
    if (prompt.trim().length === 0) {
      this.respond(peer, sequence, "Prompt is empty", true);
      return;
    }
    await this.runAgentTurn(peer, sequence, prompt);
  }

  private async tryHandleSlashCommand(peer: DosPeer, prompt: string): Promise<string | undefined> {
    const trimmed = prompt.trim();
    const separator = trimmed.search(/\s/);
    const command = separator < 0 ? trimmed.toLowerCase() : trimmed.slice(0, separator).toLowerCase();
    const argument = separator < 0 ? "" : trimmed.slice(separator).trim();
    if (command === "/status") {
      if (argument.length !== 0) return "Usage: /status\n";
      const status = this.agent.getStatus();
      return `Session: ${status.sessionId.slice(0, 8)}${status.sessionName ? ` (${status.sessionName})` : ""}\nModel: ${status.model}\nEffort: ${status.effort}\n`;
    }
    if (command === "/model") {
      if (argument.length === 0) {
        const status = this.agent.getStatus();
        return `Model: ${status.model}\nAvailable: ${status.availableModels.join(", ")}\n`;
      }
      const status = await this.agent.setModel(argument.toLowerCase());
      return `Model: ${status.model}\nEffort: ${status.effort}\n`;
    }
    if (command === "/effort") {
      if (argument.length === 0) {
        const status = this.agent.getStatus();
        return `Effort: ${status.effort}\nAvailable: ${status.availableEfforts.join(", ")}\n`;
      }
      const status = this.agent.setEffort(argument.toLowerCase());
      return `Model: ${status.model}\nEffort: ${status.effort}\n`;
    }
    if (command === "/sessions") {
      if (argument.length !== 0) return "Usage: /sessions\n";
      return formatSessions(await this.agent.listSessions());
    }
    if (command === "/resume") {
      if (argument.length === 0) return "Usage: /resume <session-id>\n";
      const session = await this.agent.resumeSession(argument);
      return `Resumed ${session.id.slice(0, 8)}${session.name ? ` (${session.name})` : ""}.\n`;
    }
    if (command === "/rename") {
      if (argument.length === 0) return "Usage: /rename <name>\n";
      this.agent.renameSession(argument);
      return `Session renamed to ${argument.trim()}.\n`;
    }
    if (command === "/delete") {
      if (argument.length === 0) return "Usage: /delete <session-id>\n";
      await this.agent.deleteSession(argument);
      return "Session deleted.\n";
    }
    if (command === "/export") {
      if (argument.length === 0) return "Usage: /export <DOS path>\n";
      const bytesWritten = await this.writeExport(peer, argument, this.agent.exportSession());
      return `Exported ${bytesWritten} bytes to ${argument}.\n`;
    }
    if (command.startsWith("/")) {
      return `Unknown command '${command}'. Run /help to see available commands.\n`;
    }
    return undefined;
  }

  private async runAgentTurn(peer: DosPeer, sequence: number, prompt: string): Promise<void> {
    this.running = true;
    this.activeSequence = sequence;
    console.log(`[user] ${prompt}`);
    const renderer = new MarkdownRenderer({
      write: (style, text) => peer.sendStyledAssistant(sequence, style, text),
    });
    this.renderer = renderer;
    try {
      await this.agent.run(prompt, (text) => renderer.feed(text));
    } catch (error) {
      const message = this.cancelRequested ? "Cancelled" : error instanceof Error ? error.message : String(error);
      peer.sendError(sequence, message);
      console.error(`[agent] ${message}`);
    } finally {
      renderer.finish();
      this.renderer = undefined;
      peer.sendComplete(sequence);
      this.running = false;
      this.activeSequence = undefined;
      this.cancelRequested = false;
    }
  }

  private respond(peer: DosPeer, sequence: number, text: string, isError = false): void {
    if (isError) peer.sendError(sequence, text);
    else peer.sendAssistant(sequence, text);
    peer.sendComplete(sequence);
  }

  private async onCancel(peer: DosPeer, sequence: number): Promise<void> {
    if (!this.running || sequence !== this.activeSequence) return;
    this.cancelRequested = true;
    await this.agent.abort();
  }

  private async onNewSession(peer: DosPeer, sequence: number): Promise<void> {
    if (this.running) {
      this.respond(peer, sequence, "Cannot start a new session while LIZA is working", true);
      return;
    }
    await this.agent.newSession();
    peer.sendAssistant(sequence, "A new conversation has started.\n");
    peer.sendComplete(sequence);
  }

  private onDisconnect(peer: DosPeer): void {
    if (this.activePeer !== peer) return;
    this.activePeer = undefined;
    if (this.running) void this.agent.abort();
    this.agent.disconnect();
    this.running = false;
    this.activeSequence = undefined;
    this.renderer = undefined;
    console.log("[dos] client disconnected");
  }

  private createSessionPort(peer: DosPeer, context: DosSessionPort["context"]): DosSessionPort {
    const flushBeforeToolCall = () => this.renderer?.finish();
    return {
      context,
      execute: (command) => {
        flushBeforeToolCall();
        return peer.execute(command);
      },
      read: (path, offset, maxBytes) => {
        flushBeforeToolCall();
        return peer.readFile(path, offset, maxBytes);
      },
      write: (path, content, mode) => {
        flushBeforeToolCall();
        return peer.writeFile(path, content, mode);
      },
      list: (path, pattern, cursor, limit) => {
        flushBeforeToolCall();
        return peer.listFiles(path, pattern, cursor, limit);
      },
      reportToolStatus: (state, label, detail) => {
        if (this.activeSequence !== undefined)
          peer.sendToolStatus(this.activeSequence, state, label, detail);
      },
    };
  }

  private async writeExport(peer: DosPeer, path: string, content: string): Promise<number> {
    const chunkSize = 12000;
    let offset = 0;
    let bytesWritten = 0;
    do {
      const chunk = content.slice(offset, offset + chunkSize);
      const result = await peer.writeFile(path, chunk, offset === 0 ? "overwrite" : "append");
      bytesWritten += result.bytesWritten;
      offset += chunk.length;
    } while (offset < content.length);
    return bytesWritten;
  }
}

function formatSessions(sessions: readonly import("./agent-driver.js").SavedSession[]): string {
  if (sessions.length === 0) return "No saved sessions.\n";
  return sessions.map((session) => {
    const name = (session.name ?? session.firstMessage.replace(/\s+/g, " ").slice(0, 36)) || "Untitled";
    const marker = session.active ? "* " : "  ";
    return `${marker}${session.id.slice(0, 8)}  ${name}  ${session.messageCount} messages\n`;
  }).join("");
}
