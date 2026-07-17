import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFetchUrlTool } from "./fetch-url.js";

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
  const tool = createFetchUrlTool();
  await assert.rejects(
    tool.execute("f-1", { url: "https://example.com" }, undefined as never, undefined as never, undefined as never),
    /TAVILY_API_KEY is not configured/,
  );
});

test("rejects non-HTTP URLs before calling Tavily", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const bodies = stubFetch(() => new Response("{}", { status: 200 }));
  const tool = createFetchUrlTool();
  await assert.rejects(
    tool.execute("f-2", { url: "not a url" }, undefined as never, undefined as never, undefined as never),
    /Invalid URL: not a url/,
  );
  await assert.rejects(
    tool.execute("f-3", { url: "ftp://example.com/x" }, undefined as never, undefined as never, undefined as never),
    /Unsupported URL protocol: ftp:/,
  );
  assert.equal(bodies.length, 0);
});

test("fetches and formats the page content", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  const bodies = stubFetch(() => new Response(JSON.stringify({
    results: [{ url: "https://example.com/a", raw_content: "# Title\n\nBody text." }],
    failed_results: [],
  }), { status: 200 }));
  const tool = createFetchUrlTool();
  const result = await tool.execute(
    "f-4",
    { url: "https://example.com/a" },
    undefined as never,
    undefined as never,
    undefined as never,
  );
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.urls, "https://example.com/a");
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.equal(text, "URL: https://example.com/a\n\n# Title\n\nBody text.");
});

test("truncates content beyond max_chars", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  stubFetch(() => new Response(JSON.stringify({
    results: [{ url: "https://example.com", raw_content: "x".repeat(500) }],
  }), { status: 200 }));
  const tool = createFetchUrlTool();
  const result = await tool.execute(
    "f-5",
    { url: "https://example.com", max_chars: 100 },
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /x{100}\n\n\[truncated\]$/);
  assert.ok(!text.includes("x".repeat(101)));
});

test("fails when Tavily returns no content", async () => {
  process.env.TAVILY_API_KEY = "test-key";
  stubFetch(() => new Response(JSON.stringify({
    results: [],
    failed_results: [{ url: "https://example.com", error: "timeout" }],
  }), { status: 200 }));
  const tool = createFetchUrlTool();
  await assert.rejects(
    tool.execute("f-6", { url: "https://example.com" }, undefined as never, undefined as never, undefined as never),
    /no content for https:\/\/example\.com: timeout/,
  );
});
