import { tavily } from "@tavily/core";
import pRetry, { AbortError } from "p-retry";

export interface TavilySearchArgs {
  query: string;
  maxResults: number;
}

export interface TavilyExtractArgs {
  urls: string[];
  format: "markdown" | "text";
}

export interface TavilySearchResult {
  answer?: string;
  results: Array<{ title: string; url: string; content: string }>;
}

export interface TavilyExtractResult {
  url: string;
  rawContent: string;
}

export interface TavilyExtractFailure {
  url: string;
  error: string;
}

export interface TavilyClient {
  search(args: TavilySearchArgs): Promise<TavilySearchResult>;
  extract(args: TavilyExtractArgs): Promise<{ results: TavilyExtractResult[]; failedResults: TavilyExtractFailure[] }>;
}

const RETRY_OPTIONS = {
  retries: 2,
  minTimeout: 500,
  factor: 2,
  shouldRetry: ({ error }: { error: unknown }) => {
    if (error instanceof TavilyRateLimitError || error instanceof TavilyServerError) return true;
    if (error instanceof TavilyClientError) return false;
    return true;
  },
};

export function createTavilyClient(): TavilyClient {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new TavilyMisconfiguredError("TAVILY_API_KEY is not configured");
  const tvly = tavily({ apiKey });
  return {
    search: (args) => pRetry(() => invokeSearch(tvly, args), RETRY_OPTIONS),
    extract: (args) => pRetry(() => invokeExtract(tvly, args), RETRY_OPTIONS),
  };
}

async function invokeSearch(tvly: ReturnType<typeof tavily>, args: TavilySearchArgs): Promise<TavilySearchResult> {
  try {
    const response = await tvly.search(args.query, {
      searchDepth: "basic",
      maxResults: args.maxResults,
      includeAnswer: true,
    });
    return {
      answer: response.answer,
      results: response.results.map((r) => ({ title: r.title, url: r.url, content: r.content })),
    };
  } catch (error) {
    throw mapTavilyError(error, "search");
  }
}

async function invokeExtract(tvly: ReturnType<typeof tavily>, args: TavilyExtractArgs): Promise<{ results: TavilyExtractResult[]; failedResults: TavilyExtractFailure[] }> {
  try {
    const response = await tvly.extract(args.urls, { format: args.format });
    return {
      results: response.results.map((r) => ({ url: r.url, rawContent: r.rawContent })),
      failedResults: response.failedResults.map((f) => ({ url: f.url, error: f.error })),
    };
  } catch (error) {
    throw mapTavilyError(error, "extract");
  }
}

function mapTavilyError(error: unknown, op: string): Error {
  const status = (error as { status?: number })?.status ?? (error as { response?: { status?: number } })?.response?.status;
  if (status === 429) return new TavilyRateLimitError(`Tavily ${op} rate limited (429)`);
  if (status !== undefined && status >= 500) return new TavilyServerError(`Tavily ${op} server error (${status})`);
  if (status !== undefined && status >= 400) return new TavilyClientError(`Tavily ${op} failed (${status})`);
  return new TavilyError(`Tavily ${op} failed: ${(error as Error)?.message ?? String(error)}`);
}

export class TavilyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TavilyError";
  }
}

export class TavilyMisconfiguredError extends TavilyError {
  constructor(message: string) {
    super(message);
    this.name = "TavilyMisconfiguredError";
  }
}

export class TavilyRateLimitError extends TavilyError {
  constructor(message: string) {
    super(message);
    this.name = "TavilyRateLimitError";
  }
}

export class TavilyServerError extends TavilyError {
  constructor(message: string) {
    super(message);
    this.name = "TavilyServerError";
  }
}

export class TavilyClientError extends TavilyError {
  constructor(message: string) {
    super(message);
    this.name = "TavilyClientError";
  }
}

export function isTavilyMisconfigured(error: unknown): error is TavilyMisconfiguredError {
  return error instanceof TavilyMisconfiguredError;
}

export { AbortError };