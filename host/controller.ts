import { ClientMode } from "./protocol.js";
import { DosPeer } from "./dos-peer.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import type { AgentDriver, AgentStatus, DosSessionPort } from "./agent-driver.js";

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
    const commandResult = await this.tryHandleSlashCommand(prompt);
    if (commandResult !== undefined) {
      this.respond(peer, sequence, commandResult);
      return;
    }
    if (this.running) {
      this.respond(peer, sequence, "LIZA is already processing a request", true);
      return;
    }
    if (prompt.trim().length === 0) {
      this.respond(peer, sequence, "Prompt is empty", true);
      return;
    }
    await this.runAgentTurn(peer, sequence, prompt);
  }

  private async tryHandleSlashCommand(prompt: string): Promise<string | undefined> {
    const [command, argument] = splitCommand(prompt);
    if (command === "/status") {
      if (argument.length !== 0) return "Usage: /status\n";
      return formatStatus(this.agent.getStatus());
    }
    if (command === "/model") {
      if (argument.length === 0) return formatModels(this.agent.getStatus());
      return formatStatus(await this.agent.setModel(argument.toLowerCase()));
    }
    if (command === "/effort") {
      if (argument.length === 0) return formatEfforts(this.agent.getStatus());
      return formatStatus(this.agent.setEffort(argument.toLowerCase()));
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
}

function splitCommand(prompt: string): [string, string] {
  const trimmed = prompt.trim();
  const separator = trimmed.search(/\s/);
  if (separator < 0) return [trimmed.toLowerCase(), ""];
  return [trimmed.slice(0, separator).toLowerCase(), trimmed.slice(separator).trim()];
}

function formatStatus(status: AgentStatus): string {
  return `Model: ${status.model}\nEffort: ${status.effort}\n`;
}

function formatModels(status: AgentStatus): string {
  return `Model: ${status.model}\nAvailable: ${status.availableModels.join(", ")}\n`;
}

function formatEfforts(status: AgentStatus): string {
  return `Effort: ${status.effort}\nAvailable: ${status.availableEfforts.join(", ")}\n`;
}