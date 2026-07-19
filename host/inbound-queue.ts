export class InboundQueue {
  private tail = Promise.resolve();

  enqueue(task: () => void | Promise<void>, onError: (error: unknown) => void): void {
    this.tail = this.tail.then(task).catch((error) => {
      try {
        onError(error);
      } catch {
        // An error handler must not poison the queue for later tasks.
      }
    });
  }

  idle(): Promise<void> {
    return this.tail;
  }
}
