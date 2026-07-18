import { SerialPort } from "serialport";
import type { WireEndpoint } from "./pipe-server.js";

const DEFAULT_RECONNECT_DELAY_MS = 1000;

export interface SerialConnectorOptions {
  path: string;
  baudRate: number;
  reconnectDelayMs?: number;
}

export class SerialConnector {
  private reconnectTimer: NodeJS.Timeout | undefined;
  private currentPort: SerialPort | undefined;

  constructor(private readonly options: SerialConnectorOptions) {}

  start(attach: (port: WireEndpoint, label: string) => void): void {
    this.open(attach);
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.currentPort?.close();
  }

  private open(attach: (port: WireEndpoint, label: string) => void): void {
    const port = new SerialPort({ path: this.options.path, baudRate: this.options.baudRate, autoOpen: false });
    this.currentPort = port;
    attach(port, "serial");
    port.on("close", () => {
      console.log("[serial] disconnected; retrying");
      this.scheduleReconnect(attach);
    });
    port.open((error) => {
      if (error) {
        console.error(`[serial] cannot open ${this.options.path}: ${error.message}`);
        this.scheduleReconnect(attach);
        return;
      }
      console.log(`[serial] connected to ${this.options.path} at ${this.options.baudRate} baud`);
    });
  }

  private scheduleReconnect(attach: (port: WireEndpoint, label: string) => void): void {
    if (this.reconnectTimer) return;
    const delay = this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open(attach);
    }, delay);
  }
}