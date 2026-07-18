import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { isTavilyMisconfigured, type TavilyClient } from "./tavily-client.js";

const MAX_CONTENT_CHARS = 12000;

export function createFetchUrlTool(client: TavilyClient) {
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
      try {
        let target: URL;
        try {
          target = new URL(params.url);
        } catch {
          throw new Error(`Invalid URL: ${params.url}`);
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          throw new Error(`Unsupported URL protocol: ${target.protocol}`);
        }

        const payload = await client.extract({
          urls: [params.url],
          format: "markdown",
        });
        const result = payload.results[0];
        if (!result) {
          const failure = payload.failedResults[0];
          throw new Error(`Tavily extract returned no content for ${params.url}${failure ? `: ${failure.error}` : ""}`);
        }

        const limit = params.max_chars ?? MAX_CONTENT_CHARS;
        const body = result.rawContent.length > limit
          ? `${result.rawContent.slice(0, limit)}\n\n[truncated]`
          : result.rawContent;
        return {
          content: [{ type: "text" as const, text: `URL: ${result.url}\n\n${body}` }],
          details: payload,
        };
      } catch (error) {
        if (isTavilyMisconfigured(error)) throw new Error("TAVILY_API_KEY is not configured");
        throw error;
      }
    },
  });
}