import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createTavilySearchTool } from "./tavily-search.js";

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const originalKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
  if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalKey;
});

function stubFetch(handler: (body: Record<string, unknown>) => Response) {
  const bodies: Array<Record<string, unknown>> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (_input: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      bodies.push(body);
      return handler(body);
    },
  });
  return bodies;
}

test("requires TAVILY_API_KEY", async () => {
  delete process.env.TAVILY_API_KEY;
  const tool = createTavilySearchTool();
  await assert.rejects(
    tool.execute("s-1", { query: "x" }, undefined as never, undefined as never, undefined as never),
    /TAVILY_API_KEY is not configured/,
  );
});

test("sends the API key and formats the answer with sources", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const bodies = stubFetch(() => new Response(JSON.stringify({
    answer: "The answer.",
    results: [{ title: "Example", url: "https://example.com", content: "Snippet." }],
  }), { status: 200 }));
  const tool = createTavilySearchTool();
  const result = await tool.execute(
    "s-2",
    { query: "space news", max_results: 3 },
    undefined as never,
    undefined as never,
    undefined as never,
  );
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.api_key, "test-key");
  assert.equal(bodies[0]?.query, "space news");
  assert.equal(bodies[0]?.max_results, 3);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Query: space news/);
  assert.match(text, /Answer:\nThe answer\./);
  assert.match(text, /- Example\n  https:\/\/example\.com\n  Snippet\./);
});

test("surfaces Tavily HTTP errors", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  stubFetch(() => new Response("rate limited", { status: 429 }));
  const tool = createTavilySearchTool();
  await assert.rejects(
    tool.execute("s-3", { query: "x" }, undefined as never, undefined as never, undefined as never),
    /Tavily search failed: 429 rate limited/,
  );
});
