import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLizaToolRegistry } from "../host/tool-registry.js";
import { inertPort } from "../host/inert-port.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const protocol = JSON.parse(await readFile(path.join(root, "protocol", "schema.json"), "utf8")) as ProtocolSchema;
const tools = createLizaToolRegistry(inertPort()).names;
const toolList = tools.map((name) => `\`${name}\``).join(", ");
const changes = [
  replaceSection("README.md", "tools", `The DOS program displays the conversation and exposes ${tools.length} sequential tools:\n${toolList}.`),
  replaceSection("docs/STATUS.md", "tools", `- [x] ${tools.length} schema-constrained sequential tools: ${toolList}`),
  replaceSection("protocol/PROTOCOL.md", "messages", renderMessages(protocol)),
];

const results = await Promise.all(changes);
if (process.argv.includes("--check")) {
  const stale = results.filter((result) => result.changed);
  for (const result of stale) console.error(`${result.file} is stale; run npm run docs:generate`);
  if (stale.length > 0) process.exitCode = 1;
} else {
  for (const result of results) if (result.changed) await writeFile(path.join(root, result.file), result.content, "utf8");
}

async function replaceSection(file: string, name: string, generated: string): Promise<GeneratedFile> {
  const source = await readFile(path.join(root, file), "utf8");
  const start = `<!-- generated:${name}:start -->`;
  const end = `<!-- generated:${name}:end -->`;
  if (!source.includes(start)) throw new Error(`${file} is missing the ${name} start marker`);
  if (!source.includes(end)) throw new Error(`${file} is missing the ${name} end marker`);
  const pattern = new RegExp(`${escape(start)}[\\s\\S]*?${escape(end)}`);
  const content = source.replace(pattern, `${start}\n${generated}\n${end}`);
  return { file, content, changed: content !== source };
}

function renderMessages(schema: ProtocolSchema): string {
  return [
    "| Value | Name | Direction | Payload |",
    "| ---: | --- | --- | --- |",
    ...schema.messages.map((message) => `| ${message.value} | \`${message.name}\` | ${message.direction} | ${message.payload} |`),
  ].join("\n");
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ProtocolSchema {
  messages: Array<{ name: string; value: number; direction: string; payload: string }>;
}

interface GeneratedFile {
  file: string;
  content: string;
  changed: boolean;
}
