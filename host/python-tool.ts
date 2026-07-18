import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { execa, ExecaError } from "execa";

const MAX_OUTPUT_CHARS = 12000;

interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export function createPythonTool(python = process.env.LIZA_PYTHON ?? "python") {
  return defineTool({
    name: "run_python",
    label: "Run Python",
    description:
      "Run Python 3 source on the Windows host (never on DOS) and return stdout, stderr, and the exit code. " +
      "NumPy, SciPy, pandas, Matplotlib, and SymPy are installed. Code runs in a fresh temporary directory " +
      "without host environment variables; use it for computation, not for touching host files.",
    parameters: Type.Object({
      source: Type.String({ minLength: 1, maxLength: 20000 }),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 120, default: 30 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const workDir = await mkdtemp(path.join(tmpdir(), "liza-py-"));
      try {
        const script = path.join(workDir, "snippet.py");
        await writeFile(script, params.source, "utf8");
        const result = await runPython(python, script, workDir, (params.timeout_seconds ?? 30) * 1000);
        return {
          content: [{ type: "text" as const, text: formatResult(result, params.timeout_seconds ?? 30) }],
          details: result,
        };
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  });
}

async function runPython(python: string, script: string, cwd: string, timeoutMs: number): Promise<PythonResult> {
  try {
    const result = await execa(python, ["-I", script], {
      cwd,
      timeout: timeoutMs,
      reject: false,
      windowsHide: true,
      all: false,
      env: {
        SystemRoot: process.env.SystemRoot ?? "",
        PATH: process.env.PATH ?? "",
        TEMP: process.env.TEMP ?? cwd,
        TMP: process.env.TMP ?? cwd,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        MPLBACKEND: "Agg",
      },
      extendEnv: false,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? null,
      timedOut: result.timedOut,
    };
  } catch (error) {
    if (error instanceof ExecaError && error.shortMessage) {
      throw new Error(`Failed to start the Python interpreter '${python}': ${error.shortMessage}`);
    }
    throw error;
  }
}

function formatResult(result: PythonResult, timeoutSeconds: number): string {
  const sections: string[] = [];
  if (result.timedOut) sections.push(`Timed out after ${timeoutSeconds} second${timeoutSeconds === 1 ? "" : "s"}; the process was killed.`);
  sections.push(`Exit code: ${result.exitCode ?? "none"}`);
  sections.push(`Stdout:\n${truncate(result.stdout)}`);
  if (result.stderr.length > 0) sections.push(`Stderr:\n${truncate(result.stderr)}`);
  return sections.join("\n");
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated]` : text;
}