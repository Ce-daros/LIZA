import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

interface TavilyExtractResult {
  url: string;
  raw_content: string;
}

interface TavilyExtractFailure {
  url: string;
  error: string;
}

interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed_results?: TavilyExtractFailure[];
}

const MAX_CONTENT_CHARS = 12000;

export function createFetchUrlTool() {
  return defineTool({
    name: "fetch_url",
    label: "Fetch a web page",
    description: "Fetch a web page URL with Tavily Extract and return its readable content as Markdown.",
    parameters: Type.Object({
      url: Type.String({ minLength: 1, maxLength: 2048 }),
      max_chars: Type.Optional(Type.Integer({ minimum: 100, maximum: MAX_CONTENT_CHARS, default: MAX_CONTENT_CHARS })),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");

      let target: URL;
      try {
        target = new URL(params.url);
      } catch {
        throw new Error(`Invalid URL: ${params.url}`);
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error(`Unsupported URL protocol: ${target.protocol}`);
      }

      const response = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          urls: params.url,
          extract_depth: "basic",
          format: "markdown",
        }),
      });
      if (!response.ok) throw new Error(`Tavily extract failed: ${response.status} ${await response.text()}`);

      const payload = await response.json() as TavilyExtractResponse;
      const result = payload.results[0];
      if (!result) {
        const failure = payload.failed_results?.[0];
        throw new Error(`Tavily extract returned no content for ${params.url}${failure ? `: ${failure.error}` : ""}`);
      }

      const limit = params.max_chars ?? MAX_CONTENT_CHARS;
      const body = result.raw_content.length > limit
        ? `${result.raw_content.slice(0, limit)}\n\n[truncated]`
        : result.raw_content;
      return {
        content: [{ type: "text" as const, text: `URL: ${result.url}\n\n${body}` }],
        details: payload,
      };
    },
  });
}
