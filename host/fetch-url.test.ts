import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFetchUrlTool } from "./fetch-url.js";
import { fakeExtractResult, stubTavilyClient } from "./test-helpers/tavily.js";

const originalKey = process.env.TAVILY_API_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalKey;
});

async function invokeFetch(client: ReturnType<typeof stubTavilyClient>["client"], params: Record<string, unknown>) {
  const tool = createFetchUrlTool(client);
  return tool.execute("f", params, undefined as never, undefined as never, undefined as never);
}

test("rejects malformed URLs before calling the client", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client, calls } = stubTavilyClient();
  await assert.rejects(invokeFetch(client, { url: "not a url" }), /Invalid URL: not a url/);
  await assert.rejects(invokeFetch(client, { url: "ftp://example.com/x" }), /Unsupported URL protocol: ftp:/);
  assert.equal(calls.length, 0);
});

test("forwards the URL and format to the client and renders the page body", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client, calls } = stubTavilyClient({
    extract: async () => fakeExtractResult([
      { url: "https://example.com/a", rawContent: "# Title\n\nBody text." },
    ]),
  });
  const result = await invokeFetch(client, { url: "https://example.com/a" });
  assert.deepEqual(calls[0]?.extract, { urls: ["https://example.com/a"], format: "markdown" });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.equal(text, "URL: https://example.com/a\n\n# Title\n\nBody text.");
});

test("truncates content beyond max_chars", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client } = stubTavilyClient({
    extract: async () => fakeExtractResult([{ url: "https://example.com", rawContent: "x".repeat(500) }]),
  });
  const result = await invokeFetch(client, { url: "https://example.com", max_chars: 100 });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /x{100}\n\n\[truncated\]$/);
  assert.ok(!text.includes("x".repeat(101)));
});

test("fails when the extract response has no results", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const { client } = stubTavilyClient({
    extract: async () => fakeExtractResult([], [{ url: "https://example.com", error: "timeout" }]),
  });
  await assert.rejects(invokeFetch(client, { url: "https://example.com" }), /no content for https:\/\/example\.com: timeout/);
});