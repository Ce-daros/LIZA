import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createTavilySearchTool } from "./tavily-search.js";
import { fakeSearchResult, stubTavilyClient } from "./test-helpers/tavily.js";

const originalKey = process.env.TAVILY_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalKey;
});

async function invokeSearch(client: ReturnType<typeof stubTavilyClient>["client"], params: Record<string, unknown>) {
  const tool = createTavilySearchTool(client);
  return tool.execute("s", params, undefined as never, undefined as never, undefined as never);
}

test("forwards query and max_results to the client and formats answer + sources", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client, calls } = stubTavilyClient({
    search: async () => fakeSearchResult({
      answer: "The answer.",
      results: [{ title: "Example", url: "https://example.com", content: "Snippet." }],
    }),
  });
  const result = await invokeSearch(client, { query: "space news", max_results: 3 });
  assert.deepEqual(calls[0]?.search, { query: "space news", maxResults: 3, topic: undefined, timeRange: undefined, includeRawContent: undefined });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /Query: space news/);
  assert.match(text, /Answer:\nThe answer\./);
  assert.match(text, /- Example\n  https:\/\/example\.com\n  Snippet\./);
});

test("propagates client errors verbatim", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client } = stubTavilyClient({
    search: async () => { throw new Error("upstream blew up"); },
  });
  await assert.rejects(invokeSearch(client, { query: "x" }), /upstream blew up/);
});

test("default max_results is 5 when caller omits it", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client, calls } = stubTavilyClient({ search: async () => fakeSearchResult() });
  await invokeSearch(client, { query: "x" });
  assert.equal(calls[0]?.search?.maxResults, 5);
});

test("omitted answer section is not rendered", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client } = stubTavilyClient({
    search: async () => fakeSearchResult({
      results: [{ title: "Only result", url: "https://x", content: "body" }],
    }),
  });
  const result = await invokeSearch(client, { query: "x" });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.doesNotMatch(text, /Answer:/);
  assert.match(text, /- Only result\n  https:\/\/x\n  body/);
});