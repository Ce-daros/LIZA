import type { TavilyClient, TavilyExtractArgs, TavilyExtractResult, TavilyExtractFailure, TavilySearchArgs, TavilySearchResult } from "../tavily-client.js";

export interface RecordedCall {
  search?: TavilySearchArgs;
  extract?: TavilyExtractArgs;
}

export interface StubOptions {
  search?: (args: TavilySearchArgs) => Promise<TavilySearchResult>;
  extract?: (args: TavilyExtractArgs) => Promise<{ results: TavilyExtractResult[]; failedResults: TavilyExtractFailure[] }>;
}

export function stubTavilyClient(opts: StubOptions = {}): { client: TavilyClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: TavilyClient = {
    search: async (args: TavilySearchArgs) => {
      calls.push({ search: args });
      if (!opts.search) throw new Error("tavily.search() not stubbed");
      return opts.search(args);
    },
    extract: async (args: TavilyExtractArgs) => {
      calls.push({ extract: args });
      if (!opts.extract) throw new Error("tavily.extract() not stubbed");
      return opts.extract(args);
    },
  };
  return { client, calls };
}

export function fakeSearchResult(overrides: Partial<TavilySearchResult> = {}): TavilySearchResult {
  return {
    results: [],
    ...overrides,
  };
}

export function fakeExtractResult(
  results: TavilyExtractResult[] = [],
  failedResults: TavilyExtractFailure[] = [],
): { results: TavilyExtractResult[]; failedResults: TavilyExtractFailure[] } {
  return { results, failedResults };
}