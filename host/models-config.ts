import { readFileSync } from "node:fs";

interface RawProvider {
  models?: Array<{
    id: string;
    name: string;
    alias?: string;
    default?: boolean;
    [key: string]: unknown;
  }>;
}

interface RawModelsConfig {
  providers: Record<string, RawProvider>;
}

export interface LizaModel {
  alias: string;
  provider: string;
  id: string;
  displayName: string;
}

export interface LizaModels {
  models: LizaModel[];
  defaultModel: LizaModel;
}

export function loadLizaModels(configPath: string): LizaModels {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as RawModelsConfig;
  const models: LizaModel[] = [];
  let defaultModel: LizaModel | undefined;
  for (const [providerName, provider] of Object.entries(raw.providers)) {
    for (const model of provider.models ?? []) {
      if (!model.alias) continue;
      const entry: LizaModel = {
        alias: model.alias,
        provider: providerName,
        id: model.id,
        displayName: model.name,
      };
      models.push(entry);
      if (model.default) defaultModel = entry;
    }
  }
  if (!defaultModel) defaultModel = models[0];
  if (!defaultModel) throw new Error(`No aliased models found in ${configPath}`);
  return { models, defaultModel };
}