import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolStatusReporter } from "./tool-status.js";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilySearchResponse {
  answer?: string;
  results: TavilyResult[];
}

export function createTavilySearchTool(reportStatus?: ToolStatusReporter) {
  return defineTool({
    name: "tavily_search",
    label: "Search the web",
    description: "Search the current web with Tavily and return an answer with source links.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 400 }),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      reportStatus?.("start", "SEARCH");
      try {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");

      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: params.query,
          search_depth: "basic",
          max_results: params.max_results ?? 5,
          include_answer: true,
        }),
      });
      if (!response.ok) throw new Error(`Tavily search failed: ${response.status} ${await response.text()}`);

      const payload = await response.json() as TavilySearchResponse;
      const sections = [
        `Query: ${params.query}`,
        ...(payload.answer ? [`Answer:\n${payload.answer}`] : []),
        "Sources:",
        ...payload.results.map((result) => `- ${result.title}\n  ${result.url}\n  ${result.content}`),
      ];
      reportStatus?.("ok", "SEARCH");
      return {
        content: [{ type: "text" as const, text: sections.join("\n") }],
        details: payload,
      };
      } catch (error) {
        reportStatus?.("fail", "SEARCH");
        throw error;
      }
    },
  });
}
