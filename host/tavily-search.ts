import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
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
        const sections = [
          `Query: ${params.query}`,
          ...(payload.answer ? [`Answer:\n${payload.answer}`] : []),
          "Sources:",
          ...payload.results.map((result) => `- ${result.title}\n  ${result.url}\n  ${result.content}`),
        ];
        return {
          content: [{ type: "text" as const, text: sections.join("\n") }],
          details: payload,
        };
      } catch (error) {
        if (isTavilyMisconfigured(error)) throw new Error("TAVILY_API_KEY is not configured", { cause: error });
        throw error;
      }
    },
  });
}