import { HEADER_SIZE, MAX_PAYLOAD, MessageType, SYNC_BYTES, VERSION } from "./protocol.generated.js";
export { ClientMode, HEADER_SIZE, MAX_PAYLOAD, MessageType, VERSION } from "./protocol.generated.js";

export const SYNC = Buffer.from(SYNC_BYTES);

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

export function splitPayload(payload: Uint8Array, maximum = MAX_PAYLOAD): Buffer[] {
  if (maximum < 1 || maximum > MAX_PAYLOAD) throw new RangeError(`invalid chunk size ${maximum}`);
  if (payload.length === 0) return [];
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < payload.length; offset += maximum) {
    chunks.push(Buffer.from(payload.subarray(offset, Math.min(offset + maximum, payload.length))));
  }
  return chunks;
}

export function decodeExitCode(payload: Uint8Array): number {
  if (payload.length < 2) throw new RangeError("command-result payload must contain an exit code");
  return Buffer.from(payload).readInt16LE();
}

export function encodeFrame(frame: Frame): Buffer {
  if (frame.payload.length > MAX_PAYLOAD) {
    throw new RangeError(`payload exceeds ${MAX_PAYLOAD} bytes`);
  }
  const result = Buffer.alloc(HEADER_SIZE + frame.payload.length);
  SYNC.copy(result, 0);
  result[2] = VERSION;
  result[3] = frame.type;
  result.writeUInt16LE(frame.sequence, 4);
  result.writeUInt16LE(frame.payload.length, 6);
  frame.payload.copy(result, HEADER_SIZE);
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

      const frameLength = HEADER_SIZE + payloadLength;
      if (this.buffer.length < frameLength) break;

      frames.push({
        type: this.buffer[3] as MessageType,
        sequence: this.buffer.readUInt16LE(4),
        payload: Buffer.from(this.buffer.subarray(HEADER_SIZE, frameLength)),
      });
      this.buffer = this.buffer.subarray(frameLength);
    }

    return frames;
  }
}
