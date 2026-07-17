# LIZA agent notes

## What this is

LIZA is a thin MS-DOS 6.22 client for a persistent Pi agent running on Windows.
The DOS guest talks to the host over a serial link (an 86Box named pipe by
default); the wire format is specified in `protocol/PROTOCOL.md`.

## Layout

- `host/` — TypeScript host (Node ESM, strict). Model tools live here:
  `dos-tool.ts`, `file-tools.ts`, `python-tool.ts`, `tavily-search.ts`,
  `fetch-url.ts`; each has a matching `*.test.ts`.
- `dos/` — 16-bit real-mode C89 client built with Open Watcom (`wmake`, see
  `dos/Makefile`).
- `protocol/` — serial protocol specification.
- `tools/` — `build_dos.ps1` (client + floppy image), `create_dos_floppy.py`.
- `config/` — `models.json` (OpenRouter routing) and related schemas.
- `vm/` — 86Box machine configuration.

## Commands

- `npm run check` — strict build plus tests. Run it before every commit.
- `npm test` — host/protocol unit tests only.
- `npm run host` — start the host. Needs `OPENROUTER_API_KEY`;
  `TAVILY_API_KEY` is required for the web tools.
- `npm run build:dos` — rebuild `LIZA.EXE` and `dos/LIZA-DOS.img`. Needs Open
  Watcom at `C:\WATCOM16` (or `-Watcom <path>`).

## Conventions

- Tests assert behavior, never tool names or schema self-checks. Every test
  must pass on a clean machine: no Open Watcom, no serial hardware, no
  network, no API keys. Guard anything environment-dependent with `skip`.
- New model tools: `defineTool` from `@earendil-works/pi-coding-agent`,
  `executionMode: "sequential"`, bounded parameters, registered in
  `host/pi-driver.ts`. Update the tool list in `host/personality.ts`,
  `README.md`, and `docs/STATUS.md` to match.
- DOS client code is strict ANSI C89: no `//` comments, no C99 types, no
  declarations after statements.
- API keys come from the environment and are never committed.
- Commit messages use Conventional Commits.
