import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownRenderer } from "./markdown-renderer.js";
import { TextStyle } from "./protocol.js";

test("renders the supported line and inline Markdown subset incrementally", () => {
  const spans: Array<[TextStyle, string]> = [];
  const renderer = new MarkdownRenderer({ write: (style, text) => spans.push([style, text]) });
  renderer.feed("# Head");
  renderer.feed("ing\nA **bold** and *soft* [link](https://x) with `code`.\n> quote\n---\n```c\nint main(void) {}\n```\n- [X] done");
  renderer.finish();

  assert.deepEqual(spans, [
    [TextStyle.Heading, "Heading"],
    [TextStyle.Normal, "\n"],
    [TextStyle.Normal, "A "],
    [TextStyle.Strong, "bold"],
    [TextStyle.Normal, " and "],
    [TextStyle.Emphasis, "soft"],
    [TextStyle.Normal, " "],
    [TextStyle.Link, "link"],
    [TextStyle.Normal, " (https://x)"],
    [TextStyle.Normal, " with "],
    [TextStyle.Code, "code"],
    [TextStyle.Normal, "."],
    [TextStyle.Normal, "\n"],
    [TextStyle.Quote, "> quote"],
    [TextStyle.Normal, "\n"],
    [TextStyle.Quote, "-".repeat(78)],
    [TextStyle.Normal, "\n"],
    [TextStyle.Code, "int main(void) {}"],
    [TextStyle.Normal, "\n"],
    [TextStyle.Normal, "- [x] done"],
  ]);
});

test("does not repeat the list prefix inside inline styled spans", () => {
  const spans: Array<[TextStyle, string]> = [];
  const renderer = new MarkdownRenderer({ write: (style, text) => spans.push([style, text]) });
  renderer.feed("- **bold** plain\n");
  renderer.finish();

  assert.deepEqual(spans, [
    [TextStyle.Normal, "- "],
    [TextStyle.Strong, "bold"],
    [TextStyle.Normal, " plain"],
    [TextStyle.Normal, "\n"],
  ]);
});
