import { ClientMode, decodeExitCode, encodeFrame, Frame, MessageType, splitPayload, TextStyle } from "./protocol.js";

export interface PeerHandlers {
  onStart(mode: ClientMode, cwd: string): void;
  onPrompt(sequence: number, prompt: string): void;
  onCancel(sequence: number): void;
  onNewSession(sequence: number): void;
  onDisconnect(): void;
}

interface PendingExecution {
  chunks: Buffer[];
  resolve(result: ShellResult): void;
  reject(error: Error): void;
}

interface PendingRead {
  kind: "read";
  chunks: Buffer[];
  resolve(result: ReadFileResult): void;
  reject(error: Error): void;
}

interface PendingWrite {
  kind: "write";
  resolve(result: WriteFileResult): void;
  reject(error: Error): void;
}

interface PendingList {
  kind: "list";
  chunks: Buffer[];
  resolve(result: ListFilesResult): void;
  reject(error: Error): void;
}

export interface ShellResult {
  output: string;
  exitCode: number;
  cwd: string;
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

export class DosPeer {
  private readonly promptChunks = new Map<number, Buffer[]>();
  private readonly executions = new Map<number, PendingExecution>();
  private readonly fileOperations = new Map<number, PendingRead | PendingWrite | PendingList>();
  private handlers: PeerHandlers | undefined;
  private nextSequence = 1;
  private connected = true;

  constructor(private readonly write: FrameWriter) {}

  get isConnected(): boolean {
    return this.connected;
  }

  setHandlers(handlers: PeerHandlers): void {
    this.handlers = handlers;
  }

  receive(frame: Frame): void {
    switch (frame.type) {
      case MessageType.Hello:
        this.sendFrame(MessageType.HelloAck, frame.sequence, Buffer.from("LIZA-HOST/0.1", "ascii"));
        return;
      case MessageType.SessionStart:
        this.receiveStart(frame);
        return;
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
        this.handlers?.onCancel(frame.sequence);
        return;
      case MessageType.NewSession:
        this.handlers?.onNewSession(frame.sequence);
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

  execute(command: string): Promise<ShellResult> {
    if (!this.connected) throw new Error("DOS client is disconnected");
    const payload = Buffer.from(command, "ascii");
    if (payload.length === 0 || payload.length > 126) throw new RangeError("DOS command must contain 1 to 126 bytes");
    const sequence = this.allocateSequence();
    return new Promise<ShellResult>((resolve, reject) => {
      this.executions.set(sequence, { chunks: [], resolve, reject });
      this.sendFrame(MessageType.ExecRequest, sequence, payload);
    });
  }

  readFile(path: string, offset: number, maxBytes: number): Promise<ReadFileResult> {
    const filePath = encodePath(path);
    if (!Number.isInteger(offset) || offset < 0 || offset > 0x7fffffff) throw new RangeError("offset must be between 0 and 2147483647");
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 16384) throw new RangeError("max_bytes must be between 1 and 16384");
    const payload = Buffer.alloc(6 + filePath.length);
    payload.writeUInt32LE(offset, 0);
    payload.writeUInt16LE(maxBytes, 4);
    filePath.copy(payload, 6);
    const sequence = this.allocateSequence();
    return new Promise<ReadFileResult>((resolve, reject) => {
      this.fileOperations.set(sequence, { kind: "read", chunks: [], resolve, reject });
      this.sendFrame(MessageType.ReadFileRequest, sequence, payload);
    });
  }

  writeFile(path: string, content: string, mode: "overwrite" | "append"): Promise<WriteFileResult> {
    const normalized = toDosAscii(content).replace(/\n/g, "\r\n");
    const bytes = Buffer.from(normalized, "ascii");
    if (bytes.length > 65535) throw new RangeError("text content must not exceed 65535 DOS bytes per call");
    return this.writeFileBytes(path, bytes, mode);
  }

  writeFileBytes(path: string, contentBytes: Uint8Array, mode: "overwrite" | "append"): Promise<WriteFileResult> {
    const filePath = encodePath(path);
    if (contentBytes.length > 1048576) throw new RangeError("binary content must not exceed 1 MiB per call");
    const sequence = this.allocateSequence();
    const start = Buffer.concat([Buffer.from([mode === "overwrite" ? 1 : 2]), filePath]);
    return new Promise<WriteFileResult>((resolve, reject) => {
      this.fileOperations.set(sequence, { kind: "write", resolve, reject });
      this.sendFrame(MessageType.WriteFileStart, sequence, start);
      for (const chunk of splitPayload(contentBytes, 512)) this.sendFrame(MessageType.WriteFileChunk, sequence, chunk);
      this.sendFrame(MessageType.WriteFileEnd, sequence, Buffer.alloc(0));
    });
  }

  listFiles(path: string, pattern: string, cursor: number, limit: number): Promise<ListFilesResult> {
    const directory = encodePath(path);
    const mask = encodePath(pattern);
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 0xffff) throw new RangeError("cursor must be between 0 and 65535");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("limit must be between 1 and 50");
    const payload = Buffer.alloc(4 + directory.length + mask.length);
    payload.writeUInt16LE(cursor, 0);
    payload[2] = limit;
    payload[3] = directory.length;
    directory.copy(payload, 4);
    mask.copy(payload, 4 + directory.length);
    const sequence = this.allocateSequence();
    return new Promise<ListFilesResult>((resolve, reject) => {
      this.fileOperations.set(sequence, { kind: "list", chunks: [], resolve, reject });
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
    for (const chunk of splitPayload(ascii, 1023)) {
      this.sendFrame(MessageType.StyledAssistantChunk, sequence, Buffer.concat([Buffer.from([style]), chunk]));
    }
  }

  sendComplete(sequence: number): void {
    this.sendFrame(MessageType.Complete, sequence, Buffer.alloc(0));
  }

  sendReady(sequence: number): void {
    this.sendFrame(MessageType.SessionReady, sequence, Buffer.alloc(0));
  }

  sendError(sequence: number, message: string): void {
    const payload = Buffer.from(toDosAscii(message).slice(0, 1024), "ascii");
    this.sendFrame(MessageType.Error, sequence, payload);
  }

  close(): void {
    if (!this.connected) return;
    this.connected = false;
    for (const pending of this.executions.values()) pending.reject(new Error("DOS client disconnected during command execution"));
    for (const pending of this.fileOperations.values()) pending.reject(new Error("DOS client disconnected during file operation"));
    this.executions.clear();
    this.fileOperations.clear();
    this.promptChunks.clear();
    this.handlers?.onDisconnect();
  }

  private receiveStart(frame: Frame): void {
    const mode = frame.payload[0];
    if (mode !== ClientMode.OneShot && mode !== ClientMode.Interactive) {
      this.sendError(frame.sequence, "Invalid client mode");
      return;
    }
    this.handlers?.onStart(mode, frame.payload.subarray(1).toString("ascii"));
    this.sendReady(frame.sequence);
  }

  private receivePromptChunk(frame: Frame): void {
    const chunks = this.promptChunks.get(frame.sequence) ?? [];
    chunks.push(Buffer.from(frame.payload));
    this.promptChunks.set(frame.sequence, chunks);
  }

  private receivePromptEnd(frame: Frame): void {
    const chunks = this.promptChunks.get(frame.sequence) ?? [];
    this.promptChunks.delete(frame.sequence);
    this.handlers?.onPrompt(frame.sequence, Buffer.concat(chunks).toString("ascii"));
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
    const pending = this.executions.get(frame.sequence);
    if (!pending) {
      this.sendError(frame.sequence, "No matching DOS command");
      return;
    }
    this.executions.delete(frame.sequence);
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
    this.fileOperations.delete(sequence);
    return pending;
  }

  private sendFrame(type: MessageType, sequence: number, payload: Buffer): void {
    if (!this.connected) throw new Error("DOS client is disconnected");
    this.write(encodeFrame({ type, sequence, payload }));
  }

  private allocateSequence(): number {
    const sequence = this.nextSequence;
    this.nextSequence = this.nextSequence === 0xffff ? 1 : this.nextSequence + 1;
    return sequence;
  }
}

export function toDosAscii(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u00a0\u2010-\u2015\u2018\u2019\u201c\u201d\u2022\u2026\u2190-\u2194\u2212]/g, (character) => {
      const replacements: Record<string, string> = {
        "\u00a0": " ",
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2015": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": "\"",
        "\u201d": "\"",
        "\u2022": "*",
        "\u2026": "...",
        "\u2190": "<-",
        "\u2191": "^",
        "\u2192": "->",
        "\u2193": "v",
        "\u2194": "<->",
        "\u2212": "-",
      };
      return replacements[character]!;
    })
    .replace(/[^\x09\x0a\x20-\x7e]/g, "?");
}

function encodePath(path: string): Buffer {
  const encoded = Buffer.from(toDosAscii(path), "ascii");
  if (encoded.length < 1 || encoded.length > 67) throw new RangeError("DOS path must contain 1 to 67 bytes");
  return encoded;
}
