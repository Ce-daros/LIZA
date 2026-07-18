import net from "node:net";

export interface WireEndpoint {
  write(data: Buffer): unknown;
  on(event: "data", listener: (data: Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

export class PipeServer {
  private server: net.Server | undefined;
  private activeSocket: net.Socket | undefined;

  constructor(private readonly pipePath: string) {}

  start(attach: (socket: net.Socket, label: string) => void): void {
    const server = net.createServer((socket) => {
      socket.setNoDelay(true);
      this.activeSocket?.destroy();
      this.activeSocket = socket;
      attach(socket, "pipe");
      socket.on("close", () => {
        if (this.activeSocket === socket) this.activeSocket = undefined;
      });
    });
    server.on("error", (error) => console.error(`[pipe] ${error.message}`));
    server.listen(this.pipePath, () => console.log(`[pipe] listening on ${this.pipePath}`));
    this.server = server;
  }

  async stop(): Promise<void> {
    this.activeSocket?.destroy();
    const server = this.server;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}