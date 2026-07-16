import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { createCompilerTools } from "./compiler-tools.js";

test("cross-compiles C89 and WASM sources into DOS MZ binaries", async () => {
  const binaries: Buffer[] = [];
  const tools = createCompilerTools(() => ({
    read: async () => ({ content: "", nextOffset: 0, eof: true }),
    write: async () => ({ bytesWritten: 0 }),
    writeBytes: async (_path, content) => {
      const binary = Buffer.from(content);
      binaries.push(binary);
      return { bytesWritten: binary.length };
    },
    list: async () => ({ entries: "", nextCursor: 0, eof: true }),
  }));
  assert.deepEqual(tools.map((tool) => tool.name), ["compile_c", "compile_asm"]);
  assert.equal(Value.Check(tools[0]!.parameters, { source: "int main(void){return 0;}", destination: "C:\\HELLO.EXE" }), true);
  assert.equal(Value.Check(tools[0]!.parameters, { source: "int main(void){return 0;}", destination: "C:\\HELLO.COM" }), false);

  const cResult = await tools[0]!.execute(
    "c-1",
    { source: "int main(void) { return 0; }", destination: "C:\\HELLO.EXE", profile: "size" },
    undefined as never,
    undefined as never,
    undefined as never,
  );
  assert.match(cResult.content[0]?.type === "text" ? cResult.content[0].text : "", /DOS MZ/);

  const asmResult = await tools[1]!.execute(
    "asm-1",
    {
      source: ".386\n.model small\n.stack 100h\n.code\nstart:\n mov ax, 4c00h\n int 21h\nend start\n",
      destination: "C:\\ASMTEST.EXE",
    },
    undefined as never,
    undefined as never,
    undefined as never,
  );
  assert.match(asmResult.content[0]?.type === "text" ? asmResult.content[0].text : "", /DOS MZ/);
  assert.equal(binaries.length, 2);
  assert.deepEqual(binaries.map((binary) => binary.subarray(0, 2).toString("ascii")), ["MZ", "MZ"]);
});
