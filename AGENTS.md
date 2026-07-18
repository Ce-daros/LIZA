# LIZA agent notes

## What this is

LIZA is a thin MS-DOS 6.22 client for a persistent Pi agent running on Windows.
The DOS guest talks to the host over a serial link (an 86Box named pipe by
default); the wire format is specified in `protocol/PROTOCOL.md`.

## Layout

- `host/` — TypeScript host (Node ESM, strict).
  - Model tools (each registered in `host/tool-registry.ts`): `dos-tool.ts`,
    `file-tools.ts`, `python-tool.ts`, `tavily-search.ts`, `fetch-url.ts`.
    `dos-tool.ts` is covered by its own tests in `host/dos-tool.test.ts`; the
    end-to-end wire format is exercised through `controller.test.ts`.
  - Protocol / transport: `controller.ts`, `dos-peer.ts`, `dos-ascii.ts`,
    `protocol.ts`, `dos-simulator.ts` (test-only DOS-end simulator).
  - Coordination primitives: `inbound-queue.ts`, `pending-requests.ts`.
  - Other: `pi-driver.ts` (Pi session lifecycle), `models-config.ts`
    (alias loader for `config/models.json`), `markdown-renderer.ts`,
    `main.ts`, `tavily-client.ts` (TAVILY SDK wrapper with p-retry).
  - Tests live alongside as `*.test.ts`; a shared TAVILY stub lives at
    `host/test-helpers/tavily.ts`.
- `dos/` — 16-bit real-mode C89 client built with Open Watcom (`wmake`, see
  `dos/Makefile`).
- `protocol/` — serial protocol specification.
- `tools/` — `build_dos.ps1` (client + floppy image), `create_dos_floppy.py`,
  `generate_protocol.mjs` (codegen from `protocol/schema.json`),
  `generate_docs.ts` (regenerates the auto-marked tool / message blocks in
  `README.md`, `docs/STATUS.md`, and `protocol/PROTOCOL.md`).
- `config/` — `models.json` (per-provider routing and the LIZA-side `alias`
  + `default` fields used by `host/models-config.ts`).
- `vm/` — 86Box machine configuration.

## Commands

- `npm run check` — strict build plus tests. Run it before every commit.
- `npm test` — host/protocol unit tests only.
- `npm run host` — start the host. Needs `OPENROUTER_API_KEY` if you intend
  to use the `ds` alias; `TAVILY_API_KEY` is required for the web tools.
- `npm run build:dos` — rebuild `LIZA.EXE` and `dos/LIZA-DOS.img`. Needs Open
  Watcom at `C:\WATCOM16` (or `-Watcom <path>`).

## Conventions

- Tests assert behavior, never tool names or schema self-checks. Every test
  must pass on a clean machine: no Open Watcom, no serial hardware, no
  network, no API keys. Guard anything environment-dependent with `skip`.
- New model tools: `defineTool` from `@earendil-works/pi-coding-agent`,
  `executionMode: "sequential"`, bounded parameters, registered in
  `host/tool-registry.ts`. The canonical tool list is generated from the
  registry by `tools/generate_docs.ts` into the auto-marked blocks in
  `README.md` and `docs/STATUS.md`; run `npm run docs:generate` after
  adding or removing a tool.
- DOS client code is strict ANSI C89: no `//` comments, no C99 types, no
  declarations after statements.
- API keys come from the environment and are never committed.
- Commit messages use Conventional Commits.
