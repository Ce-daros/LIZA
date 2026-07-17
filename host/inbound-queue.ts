export class InboundQueue {
  private tail = Promise.resolve();

  enqueue(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
    this.tail = this.tail.then(task).catch(onError);
  }

  idle(): Promise<void> {
    return this.tail;
  }
}
