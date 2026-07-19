import MarkdownIt from "markdown-it";
import { TextStyle } from "./protocol.js";

export interface StyledTextSink {
  write(style: TextStyle, text: string): void;
}

const FENCE_RE = /^\s{0,3}(```+|~~~+)/;

interface RenderFrame {
  style: TextStyle;
  prefix?: string;
  href?: string;
}

export class MarkdownRenderer {
  private readonly sink: StyledTextSink;
  private readonly md: MarkdownIt;
  private readonly env: Record<string, unknown> = {};
  private readonly stack: RenderFrame[] = [{ style: TextStyle.Normal }];
  private fenceOpen = false;
  private buffered = "";

  constructor(sink: StyledTextSink) {
    this.sink = sink;
    this.md = new MarkdownIt({
      html: false,
      linkify: false,
      typographer: false,
      breaks: false,
    });

    const renderer = this.md.renderer;
    const emit = (style: TextStyle, text: string): string => {
      sink.write(style, text);
      return "";
    };

    const current = (): RenderFrame => this.stack[this.stack.length - 1] ?? { style: TextStyle.Normal };
    const push = (frame: RenderFrame): string => { this.stack.push(frame); return ""; };
    const pop = (): string => { this.stack.pop(); return ""; };

    renderer.rules.paragraph_open = () => "";
    renderer.rules.paragraph_close = () => "";
    renderer.rules.heading_open = () => push({ style: TextStyle.Heading });
    renderer.rules.heading_close = () => pop();
    renderer.rules.hr = () => {
      emit(TextStyle.Quote, "-".repeat(78));
      return "";
    };
    renderer.rules.blockquote_open = () => push({ style: TextStyle.Quote, prefix: "> " });
    renderer.rules.blockquote_close = () => pop();
    renderer.rules.bullet_list_open = () => "";
    renderer.rules.bullet_list_close = () => "";
    renderer.rules.ordered_list_open = () => "";
    renderer.rules.ordered_list_close = () => "";
    renderer.rules.list_item_open = () => push({ style: TextStyle.Normal, prefix: "- " });
    renderer.rules.list_item_close = () => pop();
    renderer.rules.code_block = (tokens, idx) => emit(TextStyle.Code, `${tokens[idx]!.content}\n`);
    renderer.rules.hardbreak = () => emit(TextStyle.Normal, "\n");
    renderer.rules.softbreak = () => emit(TextStyle.Normal, "\n");

    renderer.rules.strong_open = () => push({ ...current(), style: TextStyle.Strong });
    renderer.rules.strong_close = () => pop();
    renderer.rules.em_open = () => push({ ...current(), style: TextStyle.Emphasis });
    renderer.rules.em_close = () => pop();
    renderer.rules.s_open = () => push({ ...current(), style: TextStyle.Quote });
    renderer.rules.s_close = () => pop();
    renderer.rules.code_inline = (tokens, idx) => emit(TextStyle.Code, tokens[idx]!.content);
    renderer.rules.text = (tokens, idx) => {
      const frame = current();
      emit(frame.style, frame.prefix ? `${frame.prefix}${tokens[idx]!.content}` : tokens[idx]!.content);
      for (const entry of this.stack) entry.prefix = undefined;
      return "";
    };

    const defaultLinkOpen = renderer.rules.link_open;
    const defaultLinkClose = renderer.rules.link_close;
    renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const href = tokens[idx]!.attrGet("href") ?? "";
      push({ ...current(), style: TextStyle.Link, href });
      return defaultLinkOpen ? defaultLinkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    };
    renderer.rules.link_close = (tokens, idx, options, env, self) => {
      const frame = current();
      if (frame.href) emit(TextStyle.Normal, ` (${frame.href})`);
      pop();
      return defaultLinkClose ? defaultLinkClose(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    };
  }

  feed(chunk: string): void {
    this.buffered += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let nl = this.buffered.indexOf("\n");
    while (nl >= 0) {
      this.renderLine(this.buffered.slice(0, nl), true);
      this.buffered = this.buffered.slice(nl + 1);
      nl = this.buffered.indexOf("\n");
    }
  }

  finish(): void {
    if (this.buffered.length > 0) {
      this.renderLine(this.buffered, false);
      this.buffered = "";
    }
  }

  private renderLine(line: string, newline: boolean): void {
    if (FENCE_RE.test(line)) {
      this.fenceOpen = !this.fenceOpen;
      return;
    }
    if (this.fenceOpen) {
      this.sink.write(TextStyle.Code, line);
      if (newline) this.sink.write(TextStyle.Normal, "\n");
      return;
    }
    if (line.trim().length === 0) return;
    const tokens = this.md.parse(`${normalizeTaskList(line)}\n`, this.env);
    this.md.renderer.render(tokens, this.md.options, this.env);
    if (newline) this.sink.write(TextStyle.Normal, "\n");
  }
}

function normalizeTaskList(line: string): string {
  return line.replace(/^(\s*[-*+]\s+)\[([ xX])\]\s+/, (_match, prefix: string, checked: string) => `${prefix}[${checked === " " ? " " : "x"}] `);
}