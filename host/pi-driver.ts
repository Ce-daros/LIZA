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
import type { AgentDriver, AgentStatus, DosSessionPort } from "./agent-driver.js";
import { buildLizaSystemPrompt } from "./system-prompt.js";
import { createLizaToolRegistry } from "./tool-registry.js";

export class PiDriver implements AgentDriver {
  private session: AgentSession | undefined;
  private modelRegistry: ModelRegistry | undefined;
  private unsubscribe: (() => void) | undefined;
  private textSink: ((text: string) => void) | undefined;
  private port: DosSessionPort | undefined;

  private constructor(
    private readonly cwd: string,
    private readonly sessionDir: string,
    private readonly modelsPath: string,
  ) {}

  static async create(cwd = process.cwd()): Promise<PiDriver> {
    const driver = new PiDriver(cwd, path.join(cwd, ".liza", "sessions"), path.join(cwd, "config", "models.json"));
    return driver;
  }

  async connect(port: DosSessionPort): Promise<void> {
    this.closeSession();
    this.port = port;
    await this.open(SessionManager.create(this.cwd, this.sessionDir));
  }

  disconnect(): void {
    this.closeSession();
    this.port = undefined;
  }

  getStatus(): AgentStatus {
    const session = this.requireSession();
    return {
      model: modelAlias(session.model!.provider, session.model!.id),
      effort: session.thinkingLevel,
      availableModels: ["mimo", "ds"],
      availableEfforts: session.getAvailableThinkingLevels(),
    };
  }

  async setModel(modelId: string): Promise<AgentStatus> {
    const selection = modelSelection(modelId);
    if (!selection) throw new RangeError(`Unknown model: ${modelId}`);
    const model = this.modelRegistry!.find(selection.provider, selection.id);
    if (!model) throw new Error(`Configured model is unavailable: ${modelId}`);
    await this.requireSession().setModel(model);
    return this.getStatus();
  }

  setEffort(effort: string): AgentStatus {
    const session = this.requireSession();
    const levels = session.getAvailableThinkingLevels();
    const level = levels.find((candidate) => candidate === effort);
    if (!level) throw new RangeError(`Unknown effort: ${effort}`);
    session.setThinkingLevel(level);
    return this.getStatus();
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
    this.requirePort();
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
    const model = modelRegistry.find("mimo", "mimo-v2.5-pro");
    if (!model) throw new Error("MiMo model mimo-v2.5-pro is not configured");
    this.modelRegistry = modelRegistry;
    const toolRegistry = createLizaToolRegistry(this.requirePort());

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => buildLizaSystemPrompt(this.requirePort().context, toolRegistry.promptEntries),
      appendSystemPromptOverride: () => [],
      extensionFactories: [{
        name: "liza-dos-context",
        factory: (pi) => {
          pi.on("before_agent_start", () => ({ systemPrompt: buildLizaSystemPrompt(this.requirePort().context, toolRegistry.promptEntries) }));
        },
      }],
    });
    await resourceLoader.reload();

    const created = await createAgentSession({
      cwd: this.cwd,
      model,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager,
      customTools: toolRegistry.tools,
      tools: toolRegistry.names,
    });
    this.session = created.session;
    this.unsubscribe = this.session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        this.textSink?.(event.assistantMessageEvent.delta);
      } else if (event.type === "tool_execution_start") {
        const status = toolRegistry.startStatus(event.toolName, event.args);
        if (status) this.requirePort().reportToolStatus("start", status.label, status.detail);
      } else if (event.type === "tool_execution_end") {
        const status = toolRegistry.endStatus(event.toolName);
        if (status) {
          const state = toolRegistry.failed(event.toolName, event.result, event.isError) ? "fail" : "ok";
          this.requirePort().reportToolStatus(state, status.label);
        }
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
    this.modelRegistry = undefined;
  }

  private requireSession(): AgentSession {
    if (!this.session) throw new Error("Pi session is not initialized");
    return this.session;
  }

  private requirePort(): DosSessionPort {
    if (!this.port) throw new Error("DOS client is not connected");
    return this.port;
  }
}

function modelSelection(alias: string): { provider: string; id: string } | undefined {
  if (alias === "mimo") return { provider: "mimo", id: "mimo-v2.5-pro" };
  if (alias === "ds" || alias === "deepseek") return { provider: "openrouter", id: "deepseek/deepseek-v4-pro" };
  return undefined;
}

function modelAlias(provider: string, id: string): string {
  if (provider === "mimo" && id === "mimo-v2.5-pro") return "mimo";
  if (provider === "openrouter" && id === "deepseek/deepseek-v4-pro") return "ds";
  throw new Error(`Model has no LIZA alias: ${provider}/${id}`);
}
