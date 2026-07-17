import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ShellResult } from "./dos-peer.js";

export interface DosShellResult extends ShellResult {
  cwdBefore: string;
}

export function createDosShellTool(executeCommand: (command: string) => Promise<DosShellResult>) {
  return defineTool({
    name: "dos_shell",
    label: "DOS shell",
    description: "Execute one MS-DOS 6.22 command line in the current LIZA invocation and return its captured output.",
    promptSnippet: "Execute one command line through the user's MS-DOS shell",
    promptGuidelines: ["Use only commands and syntax supported by MS-DOS 6.22."],
    parameters: Type.Object(
      { command: Type.String({ minLength: 1, maxLength: 126, description: "One command line to execute through COMMAND.COM." }) },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = await executeCommand(params.command);
      return {
        content: [{
          type: "text" as const,
          text: [
            `Command: ${params.command}`,
            `Working directory before: ${result.cwdBefore}`,
            `Working directory after: ${result.cwd}`,
            `Exit code: ${result.exitCode}`,
            "Output complete: yes",
            "Output:",
            result.output,
          ].join("\n"),
        }],
        details: result,
      };
    },
  });
}
