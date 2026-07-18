import assert from "node:assert/strict";
import test from "node:test";
import { mapTavilyError, TavilyRateLimitError, TavilyServerError, TavilyClientError } from "./tavily-client.js";

test("mapTavilyError classifies 429 as TavilyRateLimitError", () => {
  const error = { response: { status: 429 } };
  const mapped = mapTavilyError(error, "search");
  assert.ok(mapped instanceof TavilyRateLimitError);
  assert.match(mapped.message, /Tavily search rate limited \(429\)/);
});

test("mapTavilyError classifies 500 as TavilyServerError", () => {
  const error = { response: { status: 500 } };
  const mapped = mapTavilyError(error, "search");
  assert.ok(mapped instanceof TavilyServerError);
  assert.match(mapped.message, /Tavily search server error \(500\)/);
});

test("mapTavilyError classifies 503 as TavilyServerError", () => {
  const error = { status: 503 };
  const mapped = mapTavilyError(error, "extract");
  assert.ok(mapped instanceof TavilyServerError);
  assert.match(mapped.message, /Tavily extract server error \(503\)/);
});

test("mapTavilyError classifies 400 as TavilyClientError", () => {
  const error = { response: { status: 400 } };
  const mapped = mapTavilyError(error, "search");
  assert.ok(mapped instanceof TavilyClientError);
  assert.match(mapped.message, /Tavily search failed \(400\)/);
});

test("mapTavilyError classifies 401 as TavilyClientError", () => {
  const error = { status: 401 };
  const mapped = mapTavilyError(error, "search");
  assert.ok(mapped instanceof TavilyClientError);
});

test("mapTavilyError classifies 404 as TavilyClientError", () => {
  const error = { status: 404 };
  const mapped = mapTavilyError(error, "search");
  assert.ok(mapped instanceof TavilyClientError);
});

test("mapTavilyError falls back to generic TavilyError for unknown errors", () => {
  const error = new Error("network timeout");
  const mapped = mapTavilyError(error, "search");
  assert.ok(!(mapped instanceof TavilyRateLimitError));
  assert.ok(!(mapped instanceof TavilyServerError));
  assert.ok(!(mapped instanceof TavilyClientError));
  assert.match(mapped.message, /Tavily search failed: network timeout/);
});

test("mapTavilyError handles error without status property", () => {
  const error = { message: "socket hang up" };
  const mapped = mapTavilyError(error, "extract");
  assert.match(mapped.message, /Tavily extract failed: socket hang up/);
});

test("mapTavilyError includes operation name in message", () => {
  const error = { response: { status: 500 } };
  const mapped = mapTavilyError(error, "customOp");
  assert.match(mapped.message, /Tavily customOp server error \(500\)/);
});