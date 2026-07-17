import { ClientMode } from "./protocol.js";
import { DosPeer } from "./dos-peer.js";
import { MarkdownRenderer } from "./markdown-renderer.js";
import type { AgentDriver, AgentStatus, DosSessionPort } from "./agent-driver.js";

export class LizaController {
  private activePeer: DosPeer | undefined;
  private activeSequence: number | undefined;
  private renderer: MarkdownRenderer | undefined;
  private running = false;

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
    let commandResult: string | undefined;
    try {
      commandResult = await this.handleCommand(prompt);
    } catch (error) {
      peer.sendError(sequence, error instanceof Error ? error.message : String(error));
      peer.sendComplete(sequence);
      return;
    }
    if (commandResult !== undefined) {
      peer.sendAssistant(sequence, commandResult);
      peer.sendComplete(sequence);
      return;
    }
    if (this.running) {
      peer.sendError(sequence, "LIZA is already processing a request");
      peer.sendComplete(sequence);
      return;
    }
    if (prompt.trim().length === 0) {
      peer.sendError(sequence, "Prompt is empty");
      peer.sendComplete(sequence);
      return;
    }

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
      const message = error instanceof Error ? error.message : String(error);
      if (peer.isConnected) peer.sendError(sequence, message);
      console.error(`[agent] ${message}`);
    } finally {
      renderer.finish();
      this.renderer = undefined;
      if (peer.isConnected) peer.sendComplete(sequence);
      this.running = false;
      this.activeSequence = undefined;
    }
  }

  private async handleCommand(prompt: string): Promise<string | undefined> {
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

  private async onCancel(peer: DosPeer, sequence: number): Promise<void> {
    if (!this.running || sequence !== this.activeSequence) return;
    await this.agent.abort();
    peer.sendError(sequence, "Cancelled");
  }

  private async onNewSession(peer: DosPeer, sequence: number): Promise<void> {
    if (this.running) {
      peer.sendError(sequence, "Cannot start a new session while LIZA is working");
      peer.sendComplete(sequence);
      return;
    }
    await this.agent.newSession();
    peer.sendAssistant(sequence, "A new conversation has started.\n");
    peer.sendComplete(sequence);
  }

  private onDisconnect(peer: DosPeer): void {
    if (this.activePeer !== peer) return;
    this.activePeer = undefined;
    this.agent.disconnect();
    this.running = false;
    this.activeSequence = undefined;
    this.renderer = undefined;
    console.log("[dos] client disconnected");
  }

  private createSessionPort(peer: DosPeer, context: DosSessionPort["context"]): DosSessionPort {
    return {
      context,
      execute: (command) => {
        this.flushAssistantText();
        return peer.execute(command);
      },
      read: (path, offset, maxBytes) => {
        this.flushAssistantText();
        return peer.readFile(path, offset, maxBytes);
      },
      write: (path, content, mode) => {
        this.flushAssistantText();
        return peer.writeFile(path, content, mode);
      },
      writeBytes: (path, content, mode) => {
        this.flushAssistantText();
        return peer.writeFileBytes(path, content, mode);
      },
      list: (path, pattern, cursor, limit) => {
        this.flushAssistantText();
        return peer.listFiles(path, pattern, cursor, limit);
      },
      reportToolStatus: (state, label, detail) => {
        if (this.activeSequence !== undefined && peer.isConnected)
          peer.sendToolStatus(this.activeSequence, state, label, detail);
      },
    };
  }

  private flushAssistantText(): void {
    if (!this.renderer) throw new Error("Assistant renderer is not active");
    this.renderer.finish();
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
