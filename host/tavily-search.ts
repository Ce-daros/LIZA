import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { maxOutputChars } from "./protocol.generated.js";
import { isTavilyMisconfigured, type TavilyClient } from "./tavily-client.js";

export function createTavilySearchTool(client: TavilyClient) {
  return defineTool({
    name: "tavily_search",
    label: "Search the web",
    description: "Search the current web with Tavily and return an answer with source links.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 400 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
      topic: Type.Optional(Type.Union([Type.Literal("general"), Type.Literal("news"), Type.Literal("finance")])),
      time_range: Type.Optional(Type.Union([Type.Literal("year"), Type.Literal("month"), Type.Literal("week"), Type.Literal("day"), Type.Literal("y"), Type.Literal("m"), Type.Literal("w"), Type.Literal("d")])),
      include_raw_content: Type.Optional(Type.Union([Type.Literal(false), Type.Literal("markdown"), Type.Literal("text")])),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      try {
        const payload = await client.search({
          query: params.query,
          maxResults: params.max_results ?? 5,
          topic: params.topic,
          timeRange: params.time_range,
          includeRawContent: params.include_raw_content,
        });
        const text = formatSearchOutput(params.query, payload.answer, payload.results);
        let detailsRemaining = maxOutputChars;
        const detailsAnswer = payload.answer?.slice(0, detailsRemaining);
        detailsRemaining -= detailsAnswer?.length ?? 0;
        const detailsResults = [];
        for (const result of payload.results) {
          if (detailsRemaining <= 0) break;
          const content = result.content.slice(0, detailsRemaining);
          detailsResults.push({ ...result, content });
          detailsRemaining -= content.length;
        }
        const details = { answer: detailsAnswer, results: detailsResults };
        return {
          content: [{ type: "text" as const, text }],
          details,
        };
      } catch (error) {
        if (isTavilyMisconfigured(error)) throw new Error("TAVILY_API_KEY is not configured", { cause: error });
        throw error;
      }
    },
  });
}

function formatSearchOutput(
  query: string,
  answer: string | undefined,
  results: readonly { title: string; url: string; content: string }[],
): string {
  let text = `Query: ${query}`;
  if (answer && text.length < maxOutputChars) {
    text += `\nAnswer:\n${answer.slice(0, Math.max(0, maxOutputChars - text.length - 8))}`;
  }
  if (text.length < maxOutputChars) text += "\nSources:";
  for (const result of results) {
    const block = `- ${result.title}\n  ${result.url}\n  ${result.content}`;
    const separator = "\n";
    if (text.length + separator.length >= maxOutputChars) break;
    const remaining = maxOutputChars - text.length - separator.length;
    text += separator + block.slice(0, remaining);
    if (block.length > remaining) break;
  }
  return text;
}
