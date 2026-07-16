import { ClientMode } from "./protocol.js";
import { DosPeer, ShellResult } from "./dos-peer.js";
import type { DosContext } from "./personality.js";
import type { FileOperations } from "./file-tools.js";
import { MarkdownRenderer } from "./markdown-renderer.js";

export interface AgentDriver {
  setShellExecutor(executor: (command: string) => Promise<ShellResult>): void;
  setFileOperations(operations: FileOperations): void;
  setDosContext(context: DosContext): void;
  run(prompt: string, onText: (text: string) => void): Promise<void>;
  abort(): Promise<void>;
  newSession(): Promise<void>;
  dispose(): void;
}

export class LizaController {
  private activePeer: DosPeer | undefined;
  private activeSequence: number | undefined;
  private renderer: MarkdownRenderer | undefined;
  private running = false;

  constructor(private readonly agent: AgentDriver) {}

  attach(peer: DosPeer): void {
    this.activePeer = peer;
    this.agent.setShellExecutor((command) => {
      this.flushAssistantText();
      return peer.execute(command);
    });
    this.agent.setFileOperations({
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
    });
    peer.setHandlers({
      onStart: (mode, cwd) => this.onStart(mode, cwd),
      onPrompt: (sequence, prompt) => void this.onPrompt(peer, sequence, prompt),
      onCancel: (sequence) => void this.onCancel(peer, sequence),
      onNewSession: (sequence) => void this.onNewSession(peer, sequence),
      onDisconnect: () => this.onDisconnect(peer),
    });
  }

  dispose(): void {
    this.agent.dispose();
  }

  private onStart(mode: ClientMode, cwd: string): void {
    this.agent.setDosContext({ mode, cwd });
    const label = mode === ClientMode.OneShot ? "one-shot" : "interactive";
    console.log(`[dos] ${label} session at ${cwd}`);
  }

  private async onPrompt(peer: DosPeer, sequence: number, prompt: string): Promise<void> {
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
    if (this.running) void this.agent.abort();
    console.log("[dos] client disconnected");
  }

  private flushAssistantText(): void {
    if (!this.renderer) throw new Error("Assistant renderer is not active");
    this.renderer.finish();
  }
}
