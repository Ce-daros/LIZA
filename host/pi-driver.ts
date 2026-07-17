import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentDriver } from "./controller.js";
import type { ShellResult } from "./dos-peer.js";
import { createDosShellTool, DOS_FACING_TOOLS } from "./dos-tool.js";
import { buildLizaSystemPrompt, type DosContext } from "./personality.js";
import { ClientMode } from "./protocol.js";
import { createFileTools, type FileOperations } from "./file-tools.js";
import { createCompilerTools } from "./compiler-tools.js";
import { createTavilySearchTool } from "./tavily-search.js";
import { createFetchUrlTool } from "./fetch-url.js";

export class PiDriver implements AgentDriver {
  private session: AgentSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private textSink: ((text: string) => void) | undefined;
  private shellExecutor: ((command: string) => Promise<ShellResult>) | undefined;
  private dosContext: DosContext = { mode: ClientMode.OneShot, cwd: "C:\\" };
  private fileOperations: FileOperations | undefined;

  private constructor(
    private readonly cwd: string,
    private readonly sessionDir: string,
    private readonly modelsPath: string,
  ) {}

  static async create(cwd = process.cwd()): Promise<PiDriver> {
    const driver = new PiDriver(cwd, path.join(cwd, ".liza", "sessions"), path.join(cwd, "config", "models.json"));
    await driver.open(SessionManager.continueRecent(cwd, driver.sessionDir));
    return driver;
  }

  setShellExecutor(executor: (command: string) => Promise<ShellResult>): void {
    this.shellExecutor = executor;
  }

  setDosContext(context: DosContext): void {
    this.dosContext = context;
  }

  setFileOperations(operations: FileOperations): void {
    this.fileOperations = operations;
  }

  async run(prompt: string, onText: (text: string) => void): Promise<void> {
    if (!this.session) throw new Error("Pi session is not initialized");
    this.textSink = onText;
    try {
      await this.session.prompt(prompt, { source: "interactive" });
    } finally {
      this.textSink = undefined;
    }
  }

  async abort(): Promise<void> {
    await this.session?.abort();
  }

  async newSession(): Promise<void> {
    this.closeSession();
    await this.open(SessionManager.create(this.cwd, this.sessionDir));
  }

  dispose(): void {
    this.closeSession();
  }

  private async open(sessionManager: SessionManager): Promise<void> {
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.create(authStorage, this.modelsPath);
    const modelError = modelRegistry.getError();
    if (modelError) throw new Error(`Invalid model configuration: ${modelError}`);
    const model = modelRegistry.find("openrouter", "deepseek/deepseek-v4-pro");
    if (!model) throw new Error("OpenRouter model deepseek/deepseek-v4-pro is not configured");

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => buildLizaSystemPrompt(this.dosContext),
      appendSystemPromptOverride: () => [],
      extensionFactories: [{
        name: "liza-dos-context",
        factory: (pi) => {
          pi.on("before_agent_start", () => ({ systemPrompt: buildLizaSystemPrompt(this.dosContext) }));
        },
      }],
    });
    await resourceLoader.reload();

    const dosShell = createDosShellTool((command) => {
      if (!this.shellExecutor) throw new Error("DOS client is not connected");
      const cwdBefore = this.dosContext.cwd;
      return this.shellExecutor(command).then((result) => {
        this.dosContext = { ...this.dosContext, cwd: result.cwd };
        return { ...result, cwdBefore };
      });
    });
    const fileTools = createFileTools({
      read: (path, offset, maxBytes) => {
        if (!this.fileOperations) throw new Error("DOS client is not connected");
        return this.fileOperations.read(path, offset, maxBytes);
      },
      write: (path, content, mode) => {
        if (!this.fileOperations) throw new Error("DOS client is not connected");
        return this.fileOperations.write(path, content, mode);
      },
      writeBytes: (path, content, mode) => {
        if (!this.fileOperations) throw new Error("DOS client is not connected");
        return this.fileOperations.writeBytes(path, content, mode);
      },
      list: (path, pattern, cursor, limit) => {
        if (!this.fileOperations) throw new Error("DOS client is not connected");
        return this.fileOperations.list(path, pattern, cursor, limit);
      },
    });
    const compilerTools = createCompilerTools(() => {
      if (!this.fileOperations) throw new Error("DOS client is not connected");
      return this.fileOperations;
    });
    const tavilySearch = createTavilySearchTool();
    const fetchUrl = createFetchUrlTool();

    const created = await createAgentSession({
      cwd: this.cwd,
      model,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      customTools: [dosShell, ...fileTools, ...compilerTools, tavilySearch, fetchUrl],
      tools: [...DOS_FACING_TOOLS, "tavily_search", "fetch_url"],
    });
    this.session = created.session;
    this.unsubscribe = this.session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        this.textSink?.(event.assistantMessageEvent.delta);
      }
    });
    console.log(`[pi] session ${this.session.sessionId}`);
    console.log(`[pi] model ${model.provider}/${model.id}`);
  }

  private closeSession(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.session?.dispose();
    this.session = undefined;
  }
}
