import { LizaController } from "./controller.js";
import { DosPeer } from "./dos-peer.js";
import { PiDriver } from "./pi-driver.js";
import { PipeServer } from "./pipe-server.js";
import { SerialConnector } from "./serial.js";
import { FrameDecoder } from "./protocol.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const serialPath = process.env.LIZA_PORT;
  const pipePath = process.env.LIZA_PIPE ?? "\\\\.\\pipe\\liza-dos";
  const baudRate = numberFromEnv("LIZA_BAUD") ?? 115200;

  const driver = await PiDriver.create();
  const controller = new LizaController(driver);
  let activePeer: DosPeer | undefined;

  function attachEndpoint(endpoint: { write(data: Buffer): unknown; on(event: string, listener: (...args: unknown[]) => void): unknown }, label: string): DosPeer {
    const decoder = new FrameDecoder();
    activePeer?.close();
    const peer = new DosPeer((wire) => endpoint.write(wire));
    activePeer = peer;
    controller.attach(peer);

    endpoint.on("data", (chunk: unknown) => {
      for (const frame of decoder.push(chunk as Buffer)) peer.receive(frame);
    });
    endpoint.on("error", (error: unknown) => logger.error(`[${label}] ${(error as Error).message}`));
    endpoint.on("close", () => {
      peer.close();
      if (activePeer === peer) activePeer = undefined;
    });
    return peer;
  }

  const transport = serialPath
    ? new SerialConnector({
        path: serialPath,
        baudRate,
        reconnectDelayMs: numberFromEnv("LIZA_SERIAL_RECONNECT_MS"),
      })
    : new PipeServer(pipePath);

  transport.start(attachEndpoint);

  async function shutdown(): Promise<void> {
    logger.info("Shutting down...");
    activePeer?.close();
    controller.dispose();
    await transport.stop();
    logger.info("Shutdown complete");
  }

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
}

main().catch((error) => {
  logger.error(`[host] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number, got ${raw}`);
  }
  return parsed;
}