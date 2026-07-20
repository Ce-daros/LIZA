import { buildDosContextPrompt, type DosContext } from "./dos-context-prompt.js";
import { LIZA_PERSONALITY } from "./personality.js";
import { LIZA_RESPONSE_RULES } from "./response-rules.js";
import { buildToolPrompt, type ToolPromptEntry } from "./tool-prompt.js";
import { LIZA_ARCHITECTURE } from "./liza-architecture.js";

export function buildLizaSystemPrompt(context: DosContext, tools: readonly ToolPromptEntry[]): string {
  return [LIZA_PERSONALITY, LIZA_ARCHITECTURE, LIZA_RESPONSE_RULES, buildToolPrompt(tools), buildDosContextPrompt(context)].join("\n\n");
}
