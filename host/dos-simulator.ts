import { ClientMode, encodeExitCode, Frame, FrameDecoder, MessageType, encodeFrame } from "./protocol.js";
import { toolstatuslabelbytes, toolstatusdetailbytes } from "./protocol.generated.js";

export interface LizaDosSimulatorOptions {
  labelBytes?: number;
  detailBytes?: number;
  clientId?: string;
}

export type ToolStatusState = "start" | "ok" | "fail";

export interface ParsedToolStatus {
  state: ToolStatusState;
  label: string;
  detail: string;
  rawLabelLength: number;
  rawDetailLength: number;
}

export interface ParsedExecResult {
  sequence: number;
  chunks: string[];
  exitCode: number;
  cwd: string;
  complete: boolean;
}

export interface ParsedReadResult {
  sequence: number;
  chunks: string[];
  nextOffset: number;
  eof: boolean;
  status: number;
}

export interface ParsedWriteResult {
  sequence: number;
  status: number;
  bytesWritten: number;
}

export interface ParsedListResult {
  sequence: number;
  chunks: string[];
  nextCursor: number;
  eof: boolean;
  status: number;
}

export interface ParsedSessionStart {
  mode: ClientMode;
  cwd: string;
}

export interface ParsedPrompt {
  sequence: number;
  text: string;
}

export interface ParsedError {
  sequence: number;
  message: string;
}

export interface ParsedStyledAssistant {
  sequence: number;
  style: number;
  text: string;
}

export interface ParsedAssistant {
  sequence: number;
  text: string;
}

const DEFAULT_LABEL_BYTES = toolstatuslabelbytes;
const DEFAULT_DETAIL_BYTES = toolstatusdetailbytes;

export class LizaDosSimulator {
  readonly toolStatuses: ParsedToolStatus[] = [];
  readonly execResults: ParsedExecResult[] = [];
  readonly readResults: ParsedReadResult[] = [];
  readonly writeResults: ParsedWriteResult[] = [];
  readonly listResults: ParsedListResult[] = [];
  readonly sessionStarts: ParsedSessionStart[] = [];
  readonly prompts: ParsedPrompt[] = [];
  readonly errors: ParsedError[] = [];
  readonly styledAssistant: ParsedStyledAssistant[] = [];
  readonly assistant: ParsedAssistant[] = [];
  readonly completedSequences: number[] = [];
  disconnectCount = 0;

  private readonly decoder = new FrameDecoder();
  private readonly pendingExec = new Map<number, string[]>();
  private readonly pendingRead = new Map<number, string[]>();
  private readonly pendingWrite = new Map<number, number>();
  private readonly pendingList = new Map<number, string[]>();
  private readonly pendingPrompt = new Map<number, string[]>();
  private nextSequence = 1;

  constructor(private readonly options: LizaDosSimulatorOptions = {}) {}

  get labelBytes(): number { return this.options.labelBytes ?? DEFAULT_LABEL_BYTES; }
  get detailBytes(): number { return this.options.detailBytes ?? DEFAULT_DETAIL_BYTES; }
  get clientId(): string { return this.options.clientId ?? "LIZA-DOS/0.1"; }

  send(wire: Buffer): void {
    for (const frame of this.decoder.push(wire)) this.processFrame(frame);
  }

  sendHello(): Buffer {
    const sequence = this.allocateSequence();
    return encodeFrame({ type: MessageType.Hello, sequence, payload: Buffer.from(this.clientId, "ascii") });
  }

  sendSessionStart(mode: ClientMode, cwd: string): Buffer {
    const sequence = this.allocateSequence();
    const payload = Buffer.concat([Buffer.from([mode]), Buffer.from(cwd, "ascii")]);
    return encodeFrame({ type: MessageType.SessionStart, sequence, payload });
  }

  sendPrompt(sequence: number, text: string, chunkSize = 1024): Buffer[] {
    const bytes = Buffer.from(text, "ascii");
    const frames: Buffer[] = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      frames.push(encodeFrame({
        type: MessageType.PromptChunk,
        sequence,
        payload: bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
      }));
    }
    frames.push(encodeFrame({ type: MessageType.PromptEnd, sequence, payload: Buffer.alloc(0) }));
    return frames;
  }

  sendExecResult(sequence: number, chunks: Buffer[], exitCode: number, cwd: string, complete = true): Buffer[] {
    const frames: Buffer[] = [];
    for (const chunk of chunks) {
      frames.push(encodeFrame({ type: MessageType.ExecResultChunk, sequence, payload: chunk }));
    }
    frames.push(encodeFrame({
      type: MessageType.ExecResultEnd,
      sequence,
      payload: Buffer.concat([encodeExitCode(exitCode), Buffer.from([complete ? 1 : 0]), Buffer.from(cwd, "ascii")]),
    }));
    return frames;
  }

  sendReadResult(sequence: number, chunks: Buffer[], nextOffset: number, eof: boolean, status = 0): Buffer[] {
    const frames: Buffer[] = [];
    for (const chunk of chunks) {
      frames.push(encodeFrame({ type: MessageType.ReadFileChunk, sequence, payload: chunk }));
    }
    const ending = Buffer.alloc(7);
    ending.writeInt16LE(status, 0);
    ending.writeUInt32LE(nextOffset, 2);
    ending[6] = eof ? 1 : 0;
    frames.push(encodeFrame({ type: MessageType.ReadFileEnd, sequence, payload: ending }));
    return frames;
  }

  sendWriteResult(sequence: number, bytesWritten: number, status = 0): Buffer {
    const payload = Buffer.alloc(6);
    payload.writeInt16LE(status, 0);
    payload.writeUInt32LE(bytesWritten, 2);
    return encodeFrame({ type: MessageType.WriteFileResult, sequence, payload });
  }

  sendListResult(sequence: number, chunks: Buffer[], nextCursor: number, eof: boolean, status = 0): Buffer[] {
    const frames: Buffer[] = [];
    for (const chunk of chunks) {
      frames.push(encodeFrame({ type: MessageType.ListFilesChunk, sequence, payload: chunk }));
    }
    const ending = Buffer.alloc(5);
    ending.writeInt16LE(status, 0);
    ending.writeUInt16LE(nextCursor, 2);
    ending[4] = eof ? 1 : 0;
    frames.push(encodeFrame({ type: MessageType.ListFilesEnd, sequence, payload: ending }));
    return frames;
  }

  sendDisconnect(): Buffer {
    return encodeFrame({ type: MessageType.Disconnect, sequence: 0, payload: Buffer.alloc(0) });
  }

  private processFrame(frame: Frame): void {
    switch (frame.type) {
      case MessageType.ToolStatus:
        this.toolStatuses.push(this.parseToolStatus(frame));
        return;
      case MessageType.ExecResultChunk: {
        const list = this.pendingExec.get(frame.sequence) ?? [];
        list.push(frame.payload.toString("ascii"));
        this.pendingExec.set(frame.sequence, list);
        return;
      }
      case MessageType.ExecResultEnd: {
        if (frame.payload.length < 3) {
          this.errors.push({ sequence: frame.sequence, message: "short exec result payload" });
          return;
        }
        const chunks = this.pendingExec.get(frame.sequence) ?? [];
        this.pendingExec.delete(frame.sequence);
        const exitCode = frame.payload.readInt16LE(0);
        const complete = frame.payload[2] !== 0;
        const cwd = frame.payload.subarray(3).toString("ascii");
        this.execResults.push({ sequence: frame.sequence, chunks, exitCode, cwd, complete });
        return;
      }
      case MessageType.ReadFileChunk: {
        const list = this.pendingRead.get(frame.sequence) ?? [];
        list.push(frame.payload.toString("ascii"));
        this.pendingRead.set(frame.sequence, list);
        return;
      }
      case MessageType.ReadFileEnd: {
        if (frame.payload.length !== 7) {
          this.errors.push({ sequence: frame.sequence, message: "invalid read end payload" });
          return;
        }
        const chunks = this.pendingRead.get(frame.sequence) ?? [];
        this.pendingRead.delete(frame.sequence);
        this.readResults.push({
          sequence: frame.sequence,
          chunks,
          status: frame.payload.readInt16LE(0),
          nextOffset: frame.payload.readUInt32LE(2),
          eof: frame.payload[6] !== 0,
        });
        return;
      }
      case MessageType.WriteFileResult: {
        const chunks = this.pendingWrite.get(frame.sequence) ?? 0;
        if (frame.payload.length !== 6) {
          this.errors.push({ sequence: frame.sequence, message: "invalid write result payload" });
          return;
        }
        this.writeResults.push({
          sequence: frame.sequence,
          status: frame.payload.readInt16LE(0),
          bytesWritten: frame.payload.readUInt32LE(2),
        });
        if (chunks > 0) this.pendingWrite.delete(frame.sequence);
        return;
      }
      case MessageType.WriteFileChunk: {
        this.pendingWrite.set(frame.sequence, (this.pendingWrite.get(frame.sequence) ?? 0) + 1);
        return;
      }
      case MessageType.WriteFileStart: {
        this.pendingWrite.set(frame.sequence, 0);
        return;
      }
      case MessageType.ListFilesChunk: {
        const list = this.pendingList.get(frame.sequence) ?? [];
        list.push(frame.payload.toString("ascii"));
        this.pendingList.set(frame.sequence, list);
        return;
      }
      case MessageType.ListFilesEnd: {
        if (frame.payload.length !== 5) {
          this.errors.push({ sequence: frame.sequence, message: "invalid list end payload" });
          return;
        }
        const chunks = this.pendingList.get(frame.sequence) ?? [];
        this.pendingList.delete(frame.sequence);
        this.listResults.push({
          sequence: frame.sequence,
          chunks,
          status: frame.payload.readInt16LE(0),
          nextCursor: frame.payload.readUInt16LE(2),
          eof: frame.payload[4] !== 0,
        });
        return;
      }
      case MessageType.SessionStart: {
        if (frame.payload.length < 1) {
          this.errors.push({ sequence: frame.sequence, message: "short session start" });
          return;
        }
        const mode = frame.payload[0] as ClientMode;
        const cwd = frame.payload.subarray(1).toString("ascii");
        this.sessionStarts.push({ mode, cwd });
        return;
      }
      case MessageType.PromptChunk: {
        const list = this.pendingPrompt.get(frame.sequence) ?? [];
        list.push(frame.payload.toString("ascii"));
        this.pendingPrompt.set(frame.sequence, list);
        return;
      }
      case MessageType.PromptEnd: {
        const chunks = this.pendingPrompt.get(frame.sequence) ?? [];
        this.pendingPrompt.delete(frame.sequence);
        this.prompts.push({ sequence: frame.sequence, text: chunks.join("") });
        return;
      }
      case MessageType.Error: {
        this.errors.push({ sequence: frame.sequence, message: frame.payload.toString("ascii") });
        return;
      }
      case MessageType.StyledAssistantChunk: {
        if (frame.payload.length < 1) {
          this.errors.push({ sequence: frame.sequence, message: "empty styled assistant chunk" });
          return;
        }
        const style = frame.payload[0]!;
        this.styledAssistant.push({
          sequence: frame.sequence,
          style,
          text: frame.payload.subarray(1).toString("ascii"),
        });
        return;
      }
      case MessageType.AssistantChunk: {
        this.assistant.push({ sequence: frame.sequence, text: frame.payload.toString("ascii") });
        return;
      }
      case MessageType.Complete: {
        this.completedSequences.push(frame.sequence);
        return;
      }
      case MessageType.Disconnect: {
        this.disconnectCount += 1;
        return;
      }
      default:
        return;
    }
  }

  private parseToolStatus(frame: Frame): ParsedToolStatus {
    if (frame.payload.length < 2) {
      return { state: "start", label: "", detail: "", rawLabelLength: 0, rawDetailLength: 0 };
    }
    const stateByte = frame.payload[0];
    const state: ToolStatusState = stateByte === 0 ? "start" : stateByte === 1 ? "ok" : "fail";
    let cursor = 1;
    while (cursor < frame.payload.length && frame.payload[cursor] !== 0) cursor += 1;
    const rawLabel = frame.payload.subarray(1, cursor);
    const label = rawLabel.subarray(0, this.labelBytes).toString("ascii");
    let detail = "";
    let rawDetailLength = 0;
    if (cursor < frame.payload.length) {
      const rawDetail = frame.payload.subarray(cursor + 1);
      rawDetailLength = rawDetail.length;
      detail = rawDetail.subarray(0, this.detailBytes).toString("ascii");
    }
    return { state, label, detail, rawLabelLength: rawLabel.length, rawDetailLength };
  }

  private allocateSequence(): number {
    const sequence = this.nextSequence;
    this.nextSequence = this.nextSequence === 0xffff ? 1 : this.nextSequence + 1;
    return sequence;
  }
}