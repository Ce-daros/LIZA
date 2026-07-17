export const SYNC = Buffer.from([0x4c, 0x5a]);
export const VERSION = 1;
export const MAX_PAYLOAD = 1024;
export const HEADER_SIZE = 8;

export enum MessageType {
  Hello = 1,
  HelloAck = 2,
  Text = 3,
  Error = 4,
  Disconnect = 5,
  SessionStart = 6,
  PromptChunk = 7,
  PromptEnd = 8,
  AssistantChunk = 9,
  ExecRequest = 10,
  ExecResultChunk = 11,
  ExecResultEnd = 12,
  Complete = 13,
  Cancel = 14,
  NewSession = 15,
  SessionReady = 16,
  Ping = 17,
  Pong = 18,
  ReadFileRequest = 19,
  ReadFileChunk = 20,
  ReadFileEnd = 21,
  WriteFileStart = 22,
  WriteFileChunk = 23,
  WriteFileEnd = 24,
  WriteFileResult = 25,
  ListFilesRequest = 26,
  ListFilesChunk = 27,
  ListFilesEnd = 28,
  StyledAssistantChunk = 29,
  ToolStatus = 30,
}

export enum TextStyle {
  Normal = 0x07,
  Heading = 0x0e,
  Strong = 0x0b,
  Emphasis = 0x0a,
  Code = 0x0a,
  Quote = 0x17,
  Link = 0x0b,
}

export interface Frame {
  type: MessageType;
  sequence: number;
  payload: Buffer;
}

export enum ClientMode {
  OneShot = 1,
  Interactive = 2,
}

export function splitPayload(payload: Uint8Array, maximum = MAX_PAYLOAD): Buffer[] {
  if (maximum < 1 || maximum > MAX_PAYLOAD) throw new RangeError(`invalid chunk size ${maximum}`);
  if (payload.length === 0) return [];
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < payload.length; offset += maximum) {
    chunks.push(Buffer.from(payload.subarray(offset, Math.min(offset + maximum, payload.length))));
  }
  return chunks;
}

export function encodeExitCode(exitCode: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeInt16LE(exitCode);
  return payload;
}

export function decodeExitCode(payload: Uint8Array): number {
  if (payload.length < 2) throw new RangeError("command-result payload must contain an exit code");
  return Buffer.from(payload).readInt16LE();
}

export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function encodeFrame(frame: Frame): Buffer {
  if (frame.payload.length > MAX_PAYLOAD) {
    throw new RangeError(`payload exceeds ${MAX_PAYLOAD} bytes`);
  }
  const result = Buffer.alloc(HEADER_SIZE + frame.payload.length + 2);
  SYNC.copy(result, 0);
  result[2] = VERSION;
  result[3] = frame.type;
  result.writeUInt16LE(frame.sequence, 4);
  result.writeUInt16LE(frame.payload.length, 6);
  frame.payload.copy(result, HEADER_SIZE);
  result.writeUInt16LE(crc16(result.subarray(2, HEADER_SIZE + frame.payload.length)), HEADER_SIZE + frame.payload.length);
  return result;
}

export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];

    while (this.buffer.length >= 2) {
      const syncIndex = this.buffer.indexOf(SYNC);
      if (syncIndex < 0) {
        this.buffer = this.buffer.at(-1) === SYNC[0] ? this.buffer.subarray(-1) : Buffer.alloc(0);
        break;
      }
      if (syncIndex > 0) this.buffer = this.buffer.subarray(syncIndex);
      if (this.buffer.length < HEADER_SIZE) break;

      const payloadLength = this.buffer.readUInt16LE(6);
      if (this.buffer[2] !== VERSION || payloadLength > MAX_PAYLOAD) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      const frameLength = HEADER_SIZE + payloadLength + 2;
      if (this.buffer.length < frameLength) break;
      const expected = this.buffer.readUInt16LE(frameLength - 2);
      const actual = crc16(this.buffer.subarray(2, frameLength - 2));
      if (expected !== actual) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      frames.push({
        type: this.buffer[3] as MessageType,
        sequence: this.buffer.readUInt16LE(4),
        payload: Buffer.from(this.buffer.subarray(HEADER_SIZE, frameLength - 2)),
      });
      this.buffer = this.buffer.subarray(frameLength);
    }

    return frames;
  }
}
