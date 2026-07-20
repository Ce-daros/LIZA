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
  const seenAliases = new Set<string>();
  let defaultModel: LizaModel | undefined;
  for (const [providerName, provider] of Object.entries(raw.providers)) {
    for (const model of provider.models ?? []) {
      if (!model.alias) continue;
      if (seenAliases.has(model.alias)) throw new Error(`Duplicate model alias '${model.alias}' in ${configPath}`);
      seenAliases.add(model.alias);
      const entry: LizaModel = {
        alias: model.alias,
        provider: providerName,
        id: model.id,
        displayName: model.name,
      };
      models.push(entry);
      if (model.default) {
        if (defaultModel) throw new Error(`Multiple default models in ${configPath}: '${defaultModel.alias}' and '${entry.alias}'`);
        defaultModel = entry;
      }
    }
  }
  if (models.length === 0) throw new Error(`No aliased models found in ${configPath}`);
  if (!defaultModel) throw new Error(`No default model in ${configPath}: mark one model with "default": true`);
  return { models, defaultModel };
}