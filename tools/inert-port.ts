import type { DosSessionPort } from "../host/agent-driver.js";
import { ClientMode } from "../host/protocol.js";

const UNAVAILABLE = (): never => {
  throw new Error("inert port cannot execute DOS operations");
};

export function inertPort(): DosSessionPort {
  return {
    context: { mode: ClientMode.OneShot, cwd: "C:\\" },
    execute: UNAVAILABLE,
    read: UNAVAILABLE,
    write: UNAVAILABLE,
    list: UNAVAILABLE,
    reportToolStatus: () => {},
  };
}