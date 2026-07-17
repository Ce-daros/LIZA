export interface ToolPromptEntry {
  name: string;
  instruction: string;
}

export function buildToolPrompt(entries: readonly ToolPromptEntry[]): string {
  const instructions = entries.map((entry) => `- ${entry.name}: ${entry.instruction}`);
  return `Active sequential tools:\n${instructions.join("\n")}\n\nDo not claim to have read, written, listed, searched, fetched, or inspected anything unless you used the corresponding tool. If an operation fails, correct it or explain the failure briefly.`;
}
