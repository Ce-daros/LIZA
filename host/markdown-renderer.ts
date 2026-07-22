import MarkdownIt from "markdown-it";
import { TextStyle } from "./protocol.js";

export interface StyledTextSink {
  write(style: TextStyle, text: string): void;
}

const FENCE_RE = /^\s{0,3}(```+|~~~+)/;
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

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
  private tableCandidate: { line: string; newline: boolean } | undefined;
  private tableLines: string[] | undefined;

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
      this.acceptLine(this.buffered.slice(0, nl), true);
      this.buffered = this.buffered.slice(nl + 1);
      nl = this.buffered.indexOf("\n");
    }
  }

  finish(): void {
    if (this.buffered.length > 0) {
      this.acceptLine(this.buffered, false);
      this.buffered = "";
    }
    if (this.tableLines) {
      this.renderTable(this.tableLines);
      this.tableLines = undefined;
    }
    if (this.tableCandidate !== undefined) {
      this.renderLine(this.tableCandidate.line, this.tableCandidate.newline);
      this.tableCandidate = undefined;
    }
  }

  private acceptLine(line: string, newline: boolean): void {
    if (this.tableLines) {
      if (isTableRow(line)) {
        this.tableLines.push(line);
        return;
      }
      this.renderTable(this.tableLines);
      this.tableLines = undefined;
      this.acceptLine(line, newline);
      return;
    }
    if (this.tableCandidate !== undefined) {
      const candidate = this.tableCandidate;
      this.tableCandidate = undefined;
      if (!this.fenceOpen && TABLE_DELIMITER_RE.test(line)) {
        this.tableLines = [candidate.line, line];
        return;
      }
      this.renderLine(candidate.line, candidate.newline);
      this.acceptLine(line, newline);
      return;
    }
    if (!this.fenceOpen && isTableRow(line)) {
      this.tableCandidate = { line, newline };
      return;
    }
    this.renderLine(line, newline);
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

  private renderTable(lines: string[]): void {
    const rows = lines.map(splitTableRow);
    const header = rows[0];
    const columnCount = header?.length ?? 0;
    if (!header || columnCount === 0 || rows.slice(2).some((row) => row.length !== columnCount)) {
      for (const line of lines) this.renderLine(line, true);
      return;
    }
    const dataRows = [header, ...rows.slice(2)];
    const maximumCellWidth = Math.max(1, Math.floor((80 - (columnCount - 1) * 8) / columnCount));
    const widths = Array.from({ length: columnCount }, (_, column) => Math.min(
      maximumCellWidth,
      Math.max(3, ...dataRows.map((row) => visibleTableText(row[column] ?? "").length)),
    ));

    this.renderTableRow(header, widths, TextStyle.Heading);
    this.renderTableRow(widths.map((width) => "-".repeat(width)), widths, TextStyle.Quote);
    for (const row of rows.slice(2)) this.renderTableRow(row, widths, TextStyle.Normal);
  }

  private renderTableRow(cells: string[], widths: number[], style: TextStyle): void {
    const wrapped = cells.map((cell, column) => wrapTableText(visibleTableText(cell), widths[column]!));
    const height = Math.max(...wrapped.map((lines) => lines.length));
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < widths.length; column += 1) {
        this.sink.write(style, wrapped[column]![row] ?? "");
        if (column + 1 < widths.length) this.sink.write(TextStyle.Normal, "\t");
      }
      this.sink.write(TextStyle.Normal, "\n");
    }
  }
}

function normalizeTaskList(line: string): string {
  return line.replace(/^(\s*[-*+]\s+)\[([ xX])\]\s+/, (_match, prefix: string, checked: string) => `${prefix}[${checked === " " ? " " : "x"}] `);
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function visibleTableText(source: string): string {
  return source
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\\([\\|`*_{}\[\]()#+.!-])/g, "$1");
}

function wrapTableText(text: string, width: number): string[] {
  const result: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    const breakAt = remaining.lastIndexOf(" ", width);
    const end = breakAt > 0 ? breakAt : width;
    result.push(remaining.slice(0, end));
    remaining = remaining.slice(breakAt > 0 ? end + 1 : end);
  }
  result.push(remaining);
  return result;
}
