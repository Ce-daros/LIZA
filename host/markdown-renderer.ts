import { TextStyle } from "./protocol.js";

export interface StyledTextSink {
  write(style: TextStyle, text: string): void;
}

const inlinePattern = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_)/g;

export class MarkdownRenderer {
  private buffered = "";
  private fencedCode = false;

  constructor(private readonly sink: StyledTextSink) {}

  feed(chunk: string): void {
    this.buffered += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let newline = this.buffered.indexOf("\n");
    while (newline >= 0) {
      this.renderLine(this.buffered.slice(0, newline));
      this.buffered = this.buffered.slice(newline + 1);
      newline = this.buffered.indexOf("\n");
    }
    while (this.buffered.length > 2048) {
      this.sink.write(this.fencedCode ? TextStyle.Code : TextStyle.Normal, this.buffered.slice(0, 1024));
      this.buffered = this.buffered.slice(1024);
    }
  }

  finish(): void {
    if (this.buffered.length > 0) this.renderLine(this.buffered, false);
    this.buffered = "";
  }

  private renderLine(line: string, newline = true): void {
    if (/^\s*```/.test(line)) {
      this.fencedCode = !this.fencedCode;
      return;
    }
    if (this.fencedCode) {
      this.sink.write(TextStyle.Code, line);
      if (newline) this.sink.write(TextStyle.Normal, "\n");
      return;
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (heading) {
      this.sink.write(TextStyle.Heading, heading[1]!);
    } else if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      this.sink.write(TextStyle.Quote, "-".repeat(78));
    } else {
      const quote = line.match(/^\s{0,3}>\s?(.*)$/);
      if (quote) {
        this.sink.write(TextStyle.Quote, `> ${quote[1]}`);
      } else {
        this.renderInline(normalizeTaskList(line));
      }
    }
    if (newline) this.sink.write(TextStyle.Normal, "\n");
  }

  private renderInline(line: string): void {
    let offset = 0;
    for (const match of line.matchAll(inlinePattern)) {
      const index = match.index;
      if (index > offset) this.sink.write(TextStyle.Normal, line.slice(offset, index));
      if (match[2] !== undefined) {
        this.sink.write(TextStyle.Link, match[2]);
        this.sink.write(TextStyle.Normal, ` (${match[3]})`);
      } else if (match[4] !== undefined || match[5] !== undefined) {
        this.sink.write(TextStyle.Strong, match[4] ?? match[5]!);
      } else if (match[6] !== undefined) {
        this.sink.write(TextStyle.Code, match[6]);
      } else if (match[7] !== undefined) {
        this.sink.write(TextStyle.Quote, match[7]);
      } else {
        this.sink.write(TextStyle.Emphasis, match[8] ?? match[9]!);
      }
      offset = index + match[0].length;
    }
    if (offset < line.length) this.sink.write(TextStyle.Normal, line.slice(offset));
  }
}

function normalizeTaskList(line: string): string {
  return line.replace(/^(\s*[-*+]\s+)\[([ xX])\]\s+/, (_match, prefix: string, checked: string) => `${prefix}[${checked === " " ? " " : "x"}] `);
}
