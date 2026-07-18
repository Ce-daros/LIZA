import net from "node:net";
import { SerialPort } from "serialport";
import { LizaController } from "./controller.js";
import { DosPeer } from "./dos-peer.js";
import { PiDriver } from "./pi-driver.js";
import { FrameDecoder } from "./protocol.js";

interface WireEndpoint {
  write(data: Buffer): unknown;
  on(event: "data", listener: (data: Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

const RECONNECT_DELAY_MS = 1000;

async function main(): Promise<void> {
  const serialPath = process.env.LIZA_PORT;
  const pipePath = process.env.LIZA_PIPE ?? "\\\\.\\pipe\\liza-dos";
  const baudRate = Number(process.env.LIZA_BAUD ?? "115200");

  const driver = await PiDriver.create();
  const controller = new LizaController(driver);
  let activePeer: DosPeer | undefined;
  let activeSocket: net.Socket | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let pipeServer: net.Server | undefined;

  function attachEndpoint(endpoint: WireEndpoint, label: string): DosPeer {
    const decoder = new FrameDecoder();
    activePeer?.close();
    const peer = new DosPeer((wire) => endpoint.write(wire));
    activePeer = peer;
    controller.attach(peer);

    endpoint.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) peer.receive(frame);
    });
    endpoint.on("error", (error) => console.error(`[${label}] ${error.message}`));
    endpoint.on("close", () => {
      peer.close();
      if (activePeer === peer) activePeer = undefined;
    });
    return peer;
  }

  function scheduleSerialReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      openSerial();
    }, RECONNECT_DELAY_MS);
  }

  function openSerial(): void {
    if (!serialPath) return;
    const port = new SerialPort({ path: serialPath, baudRate, autoOpen: false });
    attachEndpoint(port, "serial");
    port.on("close", () => {
      console.log("[serial] disconnected; retrying");
      scheduleSerialReconnect();
    });
    port.open((error) => {
      if (error) {
        console.error(`[serial] cannot open ${serialPath}: ${error.message}`);
        scheduleSerialReconnect();
        return;
      }
      console.log(`[serial] connected to ${serialPath} at ${baudRate} baud`);
    });
  }

  function openPipeServer(): void {
    const server = net.createServer((socket) => {
      activeSocket?.destroy();
      activeSocket = socket;
      console.log("[pipe] DOS client connected");
      attachEndpoint(socket, "pipe");
      socket.on("close", () => {
        if (activeSocket === socket) activeSocket = undefined;
      });
    });
    server.on("error", (error) => console.error(`[pipe] ${error.message}`));
    server.listen(pipePath, () => console.log(`[pipe] listening on ${pipePath}`));
    pipeServer = server;
  }

  async function shutdown(): Promise<void> {
    activeSocket?.destroy();
    activePeer?.close();
    controller.dispose();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const server = pipeServer;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  if (serialPath) openSerial();
  else openPipeServer();
}

main().catch((error) => {
  console.error(`[host] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});