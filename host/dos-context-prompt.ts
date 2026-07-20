import type { ClientMode } from "./protocol.js";

export interface DosContext {
  mode: ClientMode;
  cwd: string;
}

export function buildDosContextPrompt(context: DosContext): string {
  const mode = context.mode === 1 ? "one-shot" : "interactive";
  const drive = context.cwd.length >= 2 && context.cwd[1] === ":" ? context.cwd.slice(0, 2) : "unknown";
  return `DOS environment for this invocation:
- Host local date and time: provided once, prepended to the first user message of the session (kept stable afterwards to preserve the prefix cache)
- Current drive: ${drive}
- Current directory: ${context.cwd}
- Client mode: ${mode}
- Shell: COMMAND.COM-compatible MS-DOS 6.22 shell
- Display: 80x25 VGA text mode
- Maximum command line: 126 bytes
- CD, drive, and SET changes persist only until this LIZA invocation exits

This DOS environment is authoritative. Never treat a Windows host path as a DOS path. The exit code and updated DOS directory returned by each dos_shell call supersede earlier values.

DO NOT KEEP TELLING USER THE CURRENT FOLDER. User can see it.`;
}
