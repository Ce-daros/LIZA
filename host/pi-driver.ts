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
import { loadLizaModels, type LizaModel } from "./models-config.js";
import { buildLizaSystemPrompt } from "./system-prompt.js";
import { createLizaToolRegistry } from "./tool-registry.js";

export class PiDriver implements AgentDriver {
  private session: AgentSession | undefined;
  private modelRegistry: ModelRegistry | undefined;
  private lizaModels: LizaModel[] = [];
  private unsubscribe: (() => void) | undefined;
  private textSink: ((text: string) => void) | undefined;
  private port: DosSessionPort | undefined;
  private sessionTimestamp: string | undefined;

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
    const alias = this.aliasForModel(session.model!.provider, session.model!.id);
    return {
      model: alias,
      effort: session.thinkingLevel,
      availableModels: this.lizaModels.map((m) => m.alias),
      availableEfforts: session.getAvailableThinkingLevels(),
    };
  }

  async setModel(alias: string): Promise<AgentStatus> {
    const target = this.lizaModels.find((m) => m.alias === alias);
    if (!target) throw new RangeError(`Unknown model: ${alias}`);
    const model = this.modelRegistry!.find(target.provider, target.id);
    if (!model) throw new Error(`Configured model is unavailable: ${alias}`);
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
    // The timestamp is captured once per session and injected only with the
    // first user message, so later turns share a stable prompt prefix and can
    // reuse the provider's prefix cache.
    const prefix = this.sessionTimestamp ? `Host local date and time: ${this.sessionTimestamp}\n\n` : "";
    this.sessionTimestamp = undefined;
    try {
      await this.session.prompt(prefix + prompt, { source: "interactive" });
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
    this.sessionTimestamp = new Date().toString();
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.create(authStorage, this.modelsPath);
    const modelError = modelRegistry.getError();
    if (modelError) throw new Error(`Invalid model configuration: ${modelError}`);
    const { models, defaultModel } = loadLizaModels(this.modelsPath);
    const model = modelRegistry.find(defaultModel.provider, defaultModel.id);
    if (!model) throw new Error(`Default model ${defaultModel.alias} (${defaultModel.provider}/${defaultModel.id}) is not configured`);

    this.modelRegistry = modelRegistry;
    this.lizaModels = models;
    const toolRegistry = createLizaToolRegistry(this.requirePort());

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
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
    this.sessionTimestamp = undefined;
    this.modelRegistry = undefined;
    this.lizaModels = [];
  }

  private aliasForModel(provider: string, id: string): string {
    const match = this.lizaModels.find((m) => m.provider === provider && m.id === id);
    if (!match) throw new Error(`Model has no LIZA alias: ${provider}/${id}`);
    return match.alias;
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