import { ClientMode, decodeExitCode, encodeFrame, Frame, MessageType, splitPayload, TextStyle } from "./protocol.js";
import { toDosAscii } from "./dos-ascii.js";
import { InboundQueue } from "./inbound-queue.js";
import { PendingRequests, type PendingRequest } from "./pending-requests.js";
import { buildExecRequest, buildListFilesRequest, buildReadFileRequest, buildWriteFileStart, writeListCursorAndLimit } from "./dos-peer-payload.js";
import {
  type FrameWriter,
  type ListFilesResult,
  type PeerHandlers,
  type ReadFileResult,
  type ShellResult,
  type WriteFileResult,
} from "./dos-peer-types.js";
import type { ToolStatusState } from "./tool-status.js";

const FILE_CHUNK_BYTES = 512;
const STYLED_CHUNK_BYTES = 1023;
const ERROR_MESSAGE_BYTES = 1024;

interface PendingExecution extends PendingRequest {
  chunks: Buffer[];
  resolve(result: ShellResult): void;
}

interface PendingRead extends PendingRequest {
  kind: "read";
  chunks: Buffer[];
  resolve(result: ReadFileResult): void;
}

interface PendingWrite extends PendingRequest {
  kind: "write";
  resolve(result: WriteFileResult): void;
}

interface PendingList extends PendingRequest {
  kind: "list";
  chunks: Buffer[];
  resolve(result: ListFilesResult): void;
}

export type { FrameWriter, ListFilesResult, PeerHandlers, ReadFileResult, ShellResult, WriteFileResult };

export class DosPeer {
  private readonly promptChunks = new Map<number, Buffer[]>();
  private readonly executions: PendingRequests<PendingExecution>;
  private readonly fileOperations: PendingRequests<PendingRead | PendingWrite | PendingList>;
  private readonly inbound = new InboundQueue();
  private handlers: PeerHandlers | undefined;
  private nextSequence = 1;
  private connected = true;

  constructor(private readonly write: FrameWriter, operationTimeoutMs = 300_000) {
    this.executions = new PendingRequests(operationTimeoutMs);
    this.fileOperations = new PendingRequests(operationTimeoutMs);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  setHandlers(handlers: PeerHandlers): void {
    this.handlers = handlers;
  }

  receive(frame: Frame): void {
    this.inbound.enqueue(
      () => this.processFrame(frame),
      (error) => this.failInbound(frame.sequence, error, frame.type !== MessageType.Cancel),
    );
  }

  whenInboundIdle(): Promise<void> {
    return this.inbound.idle();
  }

  execute(command: string): Promise<ShellResult> {
    const payload = buildExecRequest(command);
    if (payload.length === 0 || payload.length > 126) throw new RangeError("DOS command must contain 1 to 126 bytes");
    const sequence = this.allocateSequence();
    return new Promise<ShellResult>((resolve, reject) => {
      this.executions.add(sequence, "DOS command", { chunks: [], resolve, reject });
      this.sendFrame(MessageType.ExecRequest, sequence, payload);
    });
  }

  readFile(path: string, offset: number, maxBytes: number): Promise<ReadFileResult> {
    if (!Number.isInteger(offset) || offset < 0 || offset > 0x7fffffff) throw new RangeError("offset must be between 0 and 2147483647");
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 16384) throw new RangeError("max_bytes must be between 1 and 16384");
    const payload = buildReadFileRequest(path, offset, maxBytes);
    const sequence = this.allocateSequence();
    return new Promise<ReadFileResult>((resolve, reject) => {
      this.fileOperations.add(sequence, "DOS file operation", { kind: "read", chunks: [], resolve, reject });
      this.sendFrame(MessageType.ReadFileRequest, sequence, payload);
    });
  }

  writeFile(path: string, content: string, mode: "overwrite" | "append"): Promise<WriteFileResult> {
    const normalized = toDosAscii(content).replace(/\n/g, "\r\n");
    const bytes = Buffer.from(normalized, "ascii");
    if (bytes.length > 65535) throw new RangeError("text content must not exceed 65535 DOS bytes per call");
    const sequence = this.allocateSequence();
    const start = buildWriteFileStart(path, mode);
    return new Promise<WriteFileResult>((resolve, reject) => {
      this.fileOperations.add(sequence, "DOS file operation", { kind: "write", resolve, reject });
      this.sendFrame(MessageType.WriteFileStart, sequence, start);
      for (const chunk of splitPayload(bytes, FILE_CHUNK_BYTES)) this.sendFrame(MessageType.WriteFileChunk, sequence, chunk);
      this.sendFrame(MessageType.WriteFileEnd, sequence, Buffer.alloc(0));
    });
  }

  listFiles(path: string, pattern: string, cursor: number, limit: number): Promise<ListFilesResult> {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 0xffff) throw new RangeError("cursor must be between 0 and 65535");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("limit must be between 1 and 50");
    const payload = buildListFilesRequest(path, pattern);
    writeListCursorAndLimit(payload, cursor, limit);
    const sequence = this.allocateSequence();
    return new Promise<ListFilesResult>((resolve, reject) => {
      this.fileOperations.add(sequence, "DOS file operation", { kind: "list", chunks: [], resolve, reject });
      this.sendFrame(MessageType.ListFilesRequest, sequence, payload);
    });
  }

  sendAssistant(sequence: number, text: string): void {
    const ascii = toDosAscii(text);
    for (const chunk of splitPayload(Buffer.from(ascii, "ascii"))) {
      this.sendFrame(MessageType.AssistantChunk, sequence, chunk);
    }
  }

  sendStyledAssistant(sequence: number, style: TextStyle, text: string): void {
    const ascii = Buffer.from(toDosAscii(text), "ascii");
    for (const chunk of splitPayload(ascii, STYLED_CHUNK_BYTES)) {
      this.sendFrame(MessageType.StyledAssistantChunk, sequence, Buffer.concat([Buffer.from([style]), chunk]));
    }
  }

  sendToolStatus(sequence: number, state: ToolStatusState, label: string, detail = ""): void {
    const stateByte = state === "start" ? 0 : state === "ok" ? 1 : 2;
    const text = Buffer.concat([
      Buffer.from(toDosAscii(label), "ascii"),
      Buffer.from([0]),
      Buffer.from(toDosAscii(detail), "ascii"),
    ]);
    this.sendFrame(MessageType.ToolStatus, sequence, Buffer.concat([Buffer.from([stateByte]), text]));
  }

  sendComplete(sequence: number): void {
    this.sendFrame(MessageType.Complete, sequence, Buffer.alloc(0));
  }

  sendReady(sequence: number): void {
    this.sendFrame(MessageType.SessionReady, sequence, Buffer.alloc(0));
  }

  sendError(sequence: number, message: string): void {
    const payload = Buffer.from(toDosAscii(message).slice(0, ERROR_MESSAGE_BYTES), "ascii");
    this.sendFrame(MessageType.Error, sequence, payload);
  }

  close(): void {
    if (!this.connected) return;
    this.connected = false;
    this.executions.rejectAll("DOS client disconnected during command execution");
    this.fileOperations.rejectAll("DOS client disconnected during file operation");
    this.promptChunks.clear();
    this.handlers?.onDisconnect();
  }

  private async processFrame(frame: Frame): Promise<void> {
    if (!this.connected) return;
    switch (frame.type) {
      case MessageType.Hello:
        this.sendFrame(MessageType.HelloAck, frame.sequence, Buffer.from("LIZA-HOST/0.1", "ascii"));
        return;
      case MessageType.SessionStart:
        return this.receiveStart(frame);
      case MessageType.PromptChunk:
        this.receivePromptChunk(frame);
        return;
      case MessageType.PromptEnd:
        this.receivePromptEnd(frame);
        return;
      case MessageType.ExecResultChunk:
        this.receiveExecChunk(frame);
        return;
      case MessageType.ExecResultEnd:
        this.receiveExecEnd(frame);
        return;
      case MessageType.ReadFileChunk:
      case MessageType.ListFilesChunk:
        this.receiveFileChunk(frame);
        return;
      case MessageType.ReadFileEnd:
        this.receiveReadEnd(frame);
        return;
      case MessageType.WriteFileResult:
        this.receiveWriteResult(frame);
        return;
      case MessageType.ListFilesEnd:
        this.receiveListEnd(frame);
        return;
      case MessageType.Cancel:
        this.launchInbound(frame.sequence, () => this.handlers?.onCancel(frame.sequence), false);
        return;
      case MessageType.NewSession:
        this.launchInbound(frame.sequence, () => this.handlers?.onNewSession(frame.sequence), true);
        return;
      case MessageType.Disconnect:
        this.close();
        return;
      case MessageType.Ping:
        this.sendFrame(MessageType.Pong, frame.sequence, Buffer.alloc(0));
        return;
      case MessageType.Pong:
        return;
      default:
        this.sendError(frame.sequence, `Unexpected message type ${frame.type}`);
    }
  }

  private async receiveStart(frame: Frame): Promise<void> {
    const mode = frame.payload[0];
    if (mode !== ClientMode.OneShot && mode !== ClientMode.Interactive) {
      this.sendError(frame.sequence, "Invalid client mode");
      return;
    }
    const started = this.handlers?.onStart(mode, frame.payload.subarray(1).toString("ascii"));
    if (started) await started;
    if (this.connected) this.sendReady(frame.sequence);
  }

  private receivePromptChunk(frame: Frame): void {
    const chunks = this.promptChunks.get(frame.sequence) ?? [];
    chunks.push(Buffer.from(frame.payload));
    this.promptChunks.set(frame.sequence, chunks);
  }

  private receivePromptEnd(frame: Frame): void {
    const chunks = this.promptChunks.get(frame.sequence) ?? [];
    this.promptChunks.delete(frame.sequence);
    const prompt = Buffer.concat(chunks).toString("ascii");
    this.launchInbound(frame.sequence, () => this.handlers?.onPrompt(frame.sequence, prompt), true);
  }

  private receiveExecChunk(frame: Frame): void {
    const pending = this.executions.get(frame.sequence);
    if (!pending) {
      this.sendError(frame.sequence, "No matching DOS command");
      return;
    }
    pending.chunks.push(Buffer.from(frame.payload));
  }

  private receiveExecEnd(frame: Frame): void {
    const pending = this.executions.take(frame.sequence);
    if (!pending) {
      this.sendError(frame.sequence, "No matching DOS command");
      return;
    }
    const cwd = frame.payload.subarray(2).toString("ascii");
    if (cwd.length === 0) {
      pending.reject(new Error("DOS command result did not include a working directory"));
      return;
    }
    pending.resolve({
      output: Buffer.concat(pending.chunks).toString("ascii"),
      exitCode: decodeExitCode(frame.payload),
      cwd,
    });
  }

  private receiveFileChunk(frame: Frame): void {
    const pending = this.fileOperations.get(frame.sequence);
    if (!pending || (pending.kind !== "read" && pending.kind !== "list")) {
      this.sendError(frame.sequence, "No matching DOS file operation");
      return;
    }
    pending.chunks.push(Buffer.from(frame.payload));
  }

  private receiveReadEnd(frame: Frame): void {
    const pending = this.takeFileOperation(frame.sequence, "read");
    if (!pending) return;
    if (frame.payload.length !== 7) {
      pending.reject(new Error("Invalid DOS read result"));
      return;
    }
    const status = frame.payload.readInt16LE(0);
    if (status !== 0) {
      pending.reject(new Error(`DOS read failed with error ${status}`));
      return;
    }
    pending.resolve({
      content: Buffer.concat(pending.chunks).toString("ascii"),
      nextOffset: frame.payload.readUInt32LE(2),
      eof: frame.payload[6] !== 0,
    });
  }

  private receiveWriteResult(frame: Frame): void {
    const pending = this.takeFileOperation(frame.sequence, "write");
    if (!pending) return;
    if (frame.payload.length !== 6) {
      pending.reject(new Error("Invalid DOS write result"));
      return;
    }
    const status = frame.payload.readInt16LE(0);
    if (status !== 0) {
      pending.reject(new Error(`DOS write failed with error ${status}`));
      return;
    }
    pending.resolve({ bytesWritten: frame.payload.readUInt32LE(2) });
  }

  private receiveListEnd(frame: Frame): void {
    const pending = this.takeFileOperation(frame.sequence, "list");
    if (!pending) return;
    if (frame.payload.length !== 5) {
      pending.reject(new Error("Invalid DOS directory result"));
      return;
    }
    const status = frame.payload.readInt16LE(0);
    if (status !== 0) {
      pending.reject(new Error(`DOS directory listing failed with error ${status}`));
      return;
    }
    pending.resolve({
      entries: Buffer.concat(pending.chunks).toString("ascii"),
      nextCursor: frame.payload.readUInt16LE(2),
      eof: frame.payload[4] !== 0,
    });
  }

  private takeFileOperation(sequence: number, kind: "read"): PendingRead | undefined;
  private takeFileOperation(sequence: number, kind: "write"): PendingWrite | undefined;
  private takeFileOperation(sequence: number, kind: "list"): PendingList | undefined;
  private takeFileOperation(
    sequence: number,
    kind: "read" | "write" | "list",
  ): PendingRead | PendingWrite | PendingList | undefined {
    const pending = this.fileOperations.get(sequence);
    if (!pending || pending.kind !== kind) {
      this.sendError(sequence, "No matching DOS file operation");
      return undefined;
    }
    return this.fileOperations.take(sequence);
  }

  private sendFrame(type: MessageType, sequence: number, payload: Buffer): void {
    if (!this.connected) return;
    this.write(encodeFrame({ type, sequence, payload }));
  }

  private allocateSequence(): number {
    const sequence = this.nextSequence;
    this.nextSequence = this.nextSequence === 0xffff ? 1 : this.nextSequence + 1;
    return sequence;
  }

  private launchInbound(sequence: number, task: () => void | Promise<void> | undefined, completeOnError: boolean): void {
    Promise.resolve()
      .then(task)
      .catch((error) => this.failInbound(sequence, error, completeOnError));
  }

  private failInbound(sequence: number, error: unknown, complete: boolean): void {
    if (!this.connected) return;
    this.sendError(sequence, error instanceof Error ? error.message : String(error));
    if (complete) this.sendComplete(sequence);
  }
}