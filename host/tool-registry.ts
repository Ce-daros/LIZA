import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DosSessionPort } from "./agent-driver.js";
import { createDosShellTool } from "./dos-tool.js";
import { createFetchUrlTool } from "./fetch-url.js";
import { createFileTools } from "./file-tools.js";
import { createPythonTool } from "./python-tool.js";
import { createTavilySearchTool } from "./tavily-search.js";
import type { ToolPromptEntry } from "./tool-prompt.js";

interface ToolStatusDefinition {
  label: string;
  detail?(args: unknown): string;
  failed?(result: unknown): boolean;
}

interface ToolEntry {
  tool: ToolDefinition;
  instruction: string;
  status?: ToolStatusDefinition;
}

export class LizaToolRegistry {
  readonly tools: ToolDefinition[];
  readonly names: string[];
  readonly promptEntries: ToolPromptEntry[];
  private readonly byName: Map<string, ToolEntry>;

  constructor(entries: ToolEntry[]) {
    this.tools = entries.map((entry) => entry.tool);
    this.names = this.tools.map((tool) => tool.name);
    this.promptEntries = entries.map((entry) => ({ name: entry.tool.name, instruction: entry.instruction }));
    this.byName = new Map(entries.map((entry) => [entry.tool.name, entry]));
  }

  status(toolName: string, args?: unknown): { label: string; detail?: string } | undefined {
    const status = this.byName.get(toolName)?.status;
    if (!status) return undefined;
    return { label: status.label, detail: status.detail?.(args) };
  }

  failed(toolName: string, result: unknown, isError: boolean): boolean {
    if (isError) return true;
    return this.byName.get(toolName)?.status?.failed?.(result) ?? false;
  }
}

export function createLizaToolRegistry(port: DosSessionPort): LizaToolRegistry {
  const dosShell = createDosShellTool((command) => {
    const cwdBefore = port.context.cwd;
    return port.execute(command).then((result) => {
      port.context = { ...port.context, cwd: result.cwd };
      return { ...result, cwdBefore };
    });
  });
  const [readFile, writeFile, listFiles] = createFileTools(port);
  const runPython = createPythonTool();
  const tavilySearch = createTavilySearchTool();
  const fetchUrl = createFetchUrlTool();

  return new LizaToolRegistry([
    {
      tool: dosShell,
      instruction: "Run ordinary MS-DOS 6.22 commands, programs, CD, drive changes, SET, COPY, DEL, MD, RD, and REN. Do not use it to read or write file content. Do not attempt to control full-screen or graphics programs. The LIZA tool disk supplies XGREP, SED, TEE, and CWSDPMI; use them only after they are installed on PATH. XGREP and SED accept Unix-style options; COMMAND.COM pipes and redirection still use DOS syntax.",
    },
    { tool: readFile, instruction: "Read DOS file content in bounded ranges. Use it instead of TYPE." },
    { tool: writeFile, instruction: "Write DOS file content directly. Use it instead of ECHO, and use append for additional chunks." },
    { tool: listFiles, instruction: "Enumerate DOS directories in bounded pages using 8.3 wildcard patterns." },
    {
      tool: runPython,
      instruction: "Run Python 3 on the Windows transport host in a fresh temporary directory with no host environment variables. Use it for calculations and analysis; never claim it ran on DOS. Do not call plt.show().",
      status: {
        label: "PYTHON",
        failed: (result) => {
          const details = (result as { details: { exitCode: number | null; timedOut: boolean } }).details;
          return details.timedOut || details.exitCode !== 0;
        },
      },
    },
    {
      tool: tavilySearch,
      instruction: "Search the current web from the Windows transport host for timely or externally verifiable information. State the result plainly and include useful source links; do not claim you lack network access.",
      status: { label: "SEARCH", detail: (args) => (args as { query: string }).query },
    },
    {
      tool: fetchUrl,
      instruction: "Read the full content of a specific web URL from the Windows transport host, such as a source from search or an address provided by the user.",
      status: { label: "FETCH", detail: (args) => (args as { url: string }).url },
    },
  ]);
}
