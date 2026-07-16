import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { FileOperations } from "./file-tools.js";

interface ProcessResult {
  exitCode: number;
  output: string;
}

interface BuildResult {
  success: boolean;
  output: string;
  binary?: Buffer;
}

const sourceSchema = Type.String({ minLength: 1, maxLength: 60000 });
const destinationSchema = Type.String({ minLength: 1, maxLength: 67, pattern: "^[A-Za-z]:\\\\.*\\.[Ee][Xx][Ee]$" });

export function createCompilerTools(getFileOperations: () => FileOperations) {
  const compileC = defineTool({
    name: "compile_c",
    label: "Compile DOS C",
    description: "Cross-compile one C source file into a 16-bit real-mode DOS MZ executable and transfer it to the DOS computer.",
    promptGuidelines: [
      "Write strict ANSI C89/C90 accepted by Open Watcom with extensions disabled: no // comments, declarations after statements, VLAs, designated initializers, or C99/C11 library assumptions.",
      "The program targets 16-bit segmented real mode with the large memory model and may use 80386 instructions, but it must use DOS APIs and the Open Watcom 16-bit runtime.",
    ],
    parameters: Type.Object({
      source: sourceSchema,
      destination: destinationSchema,
      profile: Type.Optional(Type.Union([Type.Literal("size"), Type.Literal("debug")], { default: "size" })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = await buildC(params.source, params.profile ?? "size");
      if (!result.success || !result.binary) {
        return { content: [{ type: "text" as const, text: result.output }], details: result, isError: true };
      }
      const transfer = await getFileOperations().writeBytes(params.destination, result.binary, "overwrite");
      return {
        content: [{
          type: "text" as const,
          text: `Compiler: Open Watcom C 16-bit\nTarget: DOS MZ, 80386, real mode\nDestination: ${params.destination}\nBytes written: ${transfer.bytesWritten}\nDiagnostics:\n${result.output}`,
        }],
        details: { success: true, output: result.output },
      };
    },
  });

  const compileAsm = defineTool({
    name: "compile_asm",
    label: "Compile DOS assembly",
    description: "Assemble one Open Watcom WASM/MASM-style source file and link a 16-bit real-mode DOS MZ executable, then transfer it to DOS.",
    promptGuidelines: [
      "Use Open Watcom WASM MASM-style syntax, not NASM or GAS syntax.",
      "Generate a segmented 16-bit real-mode DOS MZ program. A .386 directive may enable 80386 instructions; use DOS interrupts/APIs and provide a valid DOS process exit.",
    ],
    parameters: Type.Object({
      source: sourceSchema,
      destination: destinationSchema,
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = await buildAsm(params.source);
      if (!result.success || !result.binary) {
        return { content: [{ type: "text" as const, text: result.output }], details: result, isError: true };
      }
      const transfer = await getFileOperations().writeBytes(params.destination, result.binary, "overwrite");
      return {
        content: [{
          type: "text" as const,
          text: `Assembler: Open Watcom WASM 16-bit\nTarget: DOS MZ, 80386, real mode\nDestination: ${params.destination}\nBytes written: ${transfer.bytesWritten}\nDiagnostics:\n${result.output}`,
        }],
        details: { success: true, output: result.output },
      };
    },
  });

  return [compileC, compileAsm];
}

async function buildC(source: string, profile: "size" | "debug"): Promise<BuildResult> {
  return inBuildDirectory(async (directory, tools, environment) => {
    await writeFile(path.join(directory, "program.c"), source, "ascii");
    const profileFlags = profile === "size" ? ["-s", "-os"] : ["-d2"];
    const compiled = await runProcess(tools.wcl, ["-q", "-bt=dos", "-ml", "-3", "-za", ...profileFlags, "-fe=program.exe", "program.c"], directory, environment);
    return finishBuild(directory, compiled);
  });
}

async function buildAsm(source: string): Promise<BuildResult> {
  return inBuildDirectory(async (directory, tools, environment) => {
    await writeFile(path.join(directory, "program.asm"), source, "ascii");
    const assembled = await runProcess(tools.wasm, ["-q", "-3", "-fo=program.obj", "program.asm"], directory, environment);
    if (assembled.exitCode !== 0) return { success: false, output: assembled.output };
    const linked = await runProcess(tools.wlink, ["system", "dos", "option", "quiet", "name", "program.exe", "file", "program.obj"], directory, environment);
    return finishBuild(directory, { exitCode: linked.exitCode, output: [assembled.output, linked.output].filter(Boolean).join("\n") });
  });
}

async function finishBuild(directory: string, processResult: ProcessResult): Promise<BuildResult> {
  if (processResult.exitCode !== 0) return { success: false, output: processResult.output };
  return { success: true, output: processResult.output || "No diagnostics.", binary: await readFile(path.join(directory, "program.exe")) };
}

async function inBuildDirectory(action: (
  directory: string,
  tools: { wcl: string; wasm: string; wlink: string },
  environment: NodeJS.ProcessEnv,
) => Promise<BuildResult>): Promise<BuildResult> {
  const watcom = process.env.WATCOM ?? "C:\\WATCOM16";
  const bin = path.join(watcom, "binnt64");
  const directory = await mkdtemp(path.join(tmpdir(), "liza-build-"));
  const environment = {
    ...process.env,
    WATCOM: watcom,
    INCLUDE: path.join(watcom, "h"),
    PATH: `${bin};${path.join(watcom, "binnt")};${process.env.PATH ?? ""}`,
  };
  try {
    return await action(directory, {
      wcl: path.join(bin, "wcl.exe"),
      wasm: path.join(bin, "wasm.exe"),
      wlink: path.join(bin, "wlink.exe"),
    }, environment);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runProcess(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", (error) => resolve({ exitCode: -1, output: error.message }));
    child.once("close", (code) => resolve({ exitCode: code ?? -1, output: Buffer.concat(chunks).toString("utf8").trim() }));
  });
}
