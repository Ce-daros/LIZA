import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLizaModels } from "./models-config.js";

function writeConfig(content: object): string {
  const dir = mkdtempSync(path.join(tmpdir(), "liza-models-"));
  const file = path.join(dir, "models.json");
  writeFileSync(file, JSON.stringify(content), "utf8");
  return file;
}

test("loads aliased models with default from explicit marker", () => {
  const file = writeConfig({
    providers: {
      mimo: { models: [{ id: "mimo-v2.5-pro", alias: "mimo", default: true, name: "MiMo" }] },
      openrouter: { models: [{ id: "deepseek/deepseek-v4-pro", alias: "ds", name: "DeepSeek" }] },
    },
  });
  const result = loadLizaModels(file);
  assert.equal(result.models.length, 2);
  assert.deepEqual(result.models.map((m) => m.alias), ["mimo", "ds"]);
  assert.equal(result.defaultModel.alias, "mimo");
  assert.equal(result.defaultModel.provider, "mimo");
  assert.equal(result.defaultModel.id, "mimo-v2.5-pro");
  rmSync(path.dirname(file), { recursive: true });
});

test("throws when no model is marked as default", () => {
  const file = writeConfig({
    providers: {
      openrouter: { models: [{ id: "x/y", alias: "first", name: "First" }] },
      mimo: { models: [{ id: "z", alias: "second", name: "Second" }] },
    },
  });
  assert.throws(() => loadLizaModels(file), /No default model/);
  rmSync(path.dirname(file), { recursive: true });
});

test("ignores models without an alias field", () => {
  const file = writeConfig({
    providers: {
      mimo: {
        models: [
          { id: "mimo-v2.5-pro", alias: "mimo", default: true, name: "MiMo" },
          { id: "internal-only", name: "NoAlias" },
        ],
      },
    },
  });
  const result = loadLizaModels(file);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0]?.alias, "mimo");
  rmSync(path.dirname(file), { recursive: true });
});

test("throws when no aliased models are configured", () => {
  const file = writeConfig({
    providers: { mimo: { models: [{ id: "x", name: "X" }] } },
  });
  assert.throws(() => loadLizaModels(file), /No aliased models/);
  rmSync(path.dirname(file), { recursive: true });
});

test("throws on duplicate aliases", () => {
  const file = writeConfig({
    providers: {
      mimo: { models: [{ id: "a", alias: "dup", name: "A" }] },
      openrouter: { models: [{ id: "b", alias: "dup", name: "B" }] },
    },
  });
  assert.throws(() => loadLizaModels(file), /Duplicate model alias 'dup'/);
  rmSync(path.dirname(file), { recursive: true });
});

test("throws on multiple default markers", () => {
  const file = writeConfig({
    providers: {
      mimo: { models: [{ id: "a", alias: "one", default: true, name: "A" }] },
      openrouter: { models: [{ id: "b", alias: "two", default: true, name: "B" }] },
    },
  });
  assert.throws(() => loadLizaModels(file), /Multiple default models/);
  rmSync(path.dirname(file), { recursive: true });
});