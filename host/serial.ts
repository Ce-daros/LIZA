import { SerialPort } from "serialport";
import type { WireEndpoint } from "./pipe-server.js";
import { defaultReconnectDelayMs } from "./protocol.generated.js";
import { logger } from "./logger.js";

export interface SerialConnectorOptions {
  path: string;
  baudRate: number;
  reconnectDelayMs?: number;
}

export class SerialConnector {
  private reconnectTimer: NodeJS.Timeout | undefined;
  private currentPort: SerialPort | undefined;
  private closed = false;

  constructor(private readonly options: SerialConnectorOptions) {}

  start(attach: (port: WireEndpoint, label: string) => void): void {
    this.open(attach);
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.currentPort) {
      await new Promise<void>((resolve) => {
        this.currentPort!.close(() => resolve());
      });
      this.currentPort = undefined;
    }
  }

  private open(attach: (port: WireEndpoint, label: string) => void): void {
    const port = new SerialPort({ path: this.options.path, baudRate: this.options.baudRate, autoOpen: false });
    this.currentPort = port;
    attach(port, "serial");
    port.on("close", () => {
      logger.info("[serial] disconnected; retrying");
      if (!this.closed) this.scheduleReconnect(attach);
    });
    port.open((error) => {
      if (error) {
        logger.error(`[serial] cannot open ${this.options.path}: ${error.message}`);
        if (!this.closed) this.scheduleReconnect(attach);
        return;
      }
      logger.info(`[serial] connected to ${this.options.path} at ${this.options.baudRate} baud`);
    });
  }

  private scheduleReconnect(attach: (port: WireEndpoint, label: string) => void): void {
    if (this.reconnectTimer) return;
    const delay = this.options.reconnectDelayMs ?? defaultReconnectDelayMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open(attach);
    }, delay);
  }
}