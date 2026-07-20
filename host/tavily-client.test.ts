import assert from "node:assert/strict";
import test from "node:test";
import { tavily } from "@tavily/core";
import {
  createTavilyClient,
  TavilyRateLimitError,
  TavilyServerError,
  TavilyClientError,
  TavilyError,
} from "./tavily-client.js";

type TavilySdk = ReturnType<typeof tavily>;

function failingSdk(error: unknown): TavilySdk {
  const fail = () => Promise.reject(error);
  return { search: fail, extract: fail } as unknown as TavilySdk;
}

const searchArgs = { query: "q", maxResults: 3 };
const extractArgs = { urls: ["https://example.com"], format: "markdown" as const };

test("search maps 429 to TavilyRateLimitError", async () => {
  const client = createTavilyClient(failingSdk({ response: { status: 429 } }));
  await assert.rejects(client.search(searchArgs), (error: unknown) => {
    assert.ok(error instanceof TavilyRateLimitError);
    assert.match(error.message, /Tavily search rate limited \(429\)/);
    return true;
  });
});

test("search maps 500 to TavilyServerError", async () => {
  const client = createTavilyClient(failingSdk({ response: { status: 500 } }));
  await assert.rejects(client.search(searchArgs), (error: unknown) => {
    assert.ok(error instanceof TavilyServerError);
    assert.match(error.message, /Tavily search server error \(500\)/);
    return true;
  });
});

test("extract maps 503 to TavilyServerError", async () => {
  const client = createTavilyClient(failingSdk({ status: 503 }));
  await assert.rejects(client.extract(extractArgs), (error: unknown) => {
    assert.ok(error instanceof TavilyServerError);
    assert.match(error.message, /Tavily extract server error \(503\)/);
    return true;
  });
});

test("search maps 4xx to TavilyClientError", async () => {
  for (const error of [{ response: { status: 400 } }, { status: 401 }, { status: 404 }]) {
    const client = createTavilyClient(failingSdk(error));
    await assert.rejects(client.search(searchArgs), (mapped: unknown) => {
      assert.ok(mapped instanceof TavilyClientError);
      return true;
    });
  }
});

test("search falls back to generic TavilyError for unknown errors", async () => {
  const client = createTavilyClient(failingSdk(new Error("network timeout")));
  await assert.rejects(client.search(searchArgs), (error: unknown) => {
    assert.ok(error instanceof TavilyError);
    assert.ok(!(error instanceof TavilyRateLimitError));
    assert.ok(!(error instanceof TavilyServerError));
    assert.ok(!(error instanceof TavilyClientError));
    assert.match(error.message, /Tavily search failed: network timeout/);
    return true;
  });
});

test("extract handles errors without a status property", async () => {
  const client = createTavilyClient(failingSdk({ message: "socket hang up" }));
  await assert.rejects(client.extract(extractArgs), (error: unknown) => {
    assert.match((error as Error).message, /Tavily extract failed: socket hang up/);
    return true;
  });
});
