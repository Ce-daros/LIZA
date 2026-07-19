export interface PendingRequest {
  reject(error: Error): void;
}

interface PendingEntry<T> {
  request: T;
  timer: NodeJS.Timeout;
}

export class PendingRequests<T extends PendingRequest> {
  private readonly entries = new Map<number, PendingEntry<T>>();

  constructor(private readonly timeoutMs: number) {}

  add(sequence: number, operation: string, request: T): void {
    const existing = this.entries.get(sequence);
    if (existing) {
      this.entries.delete(sequence);
      clearTimeout(existing.timer);
      existing.request.reject(new Error(`${operation} was superseded by another request with sequence ${sequence}`));
    }
    const timer = setTimeout(() => {
      this.entries.delete(sequence);
      request.reject(new Error(`${operation} timed out after ${this.timeoutMs} ms without a response from the DOS guest; it may be busy or stuck`));
    }, this.timeoutMs);
    timer.unref();
    this.entries.set(sequence, { request, timer });
  }

  get(sequence: number): T | undefined {
    return this.entries.get(sequence)?.request;
  }

  take(sequence: number): T | undefined {
    const entry = this.entries.get(sequence);
    if (!entry) return undefined;
    this.entries.delete(sequence);
    clearTimeout(entry.timer);
    return entry.request;
  }

  rejectAll(message: string): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      entry.request.reject(new Error(message));
    }
    this.entries.clear();
  }
}
