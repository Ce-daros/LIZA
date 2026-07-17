# LIZA

<img width="1082" height="502" alt="image" src="https://github.com/user-attachments/assets/af6c701d-6d8a-4a89-9238-5c5a0c94ed26" />

LIZA is a thin MS-DOS 6.22 client for a persistent Pi agent running on Windows.
The DOS program displays the conversation and exposes eight sequential tools:
`dos_shell`, `read_file`, `write_file`, `list_files`, `compile_c`, and
`compile_asm`, plus `tavily_search` and `fetch_url`. File and shell operations occur on the guest. Compilation uses the
fixed Open Watcom host toolchain and transfers only the resulting DOS executable.

## Requirements

- Windows 11 and 86Box 5.4
- Node.js 22.19 or newer
- Open Watcom 16-bit DOS compiler at `C:\WATCOM16`
- MS-DOS 6.22 guest with an emulated COM1 connection
- `OPENROUTER_API_KEY` in the host environment
- `TAVILY_API_KEY` in the host environment for web search and URL fetching

## Host

```powershell
npm install
npm run check
npm run host
```

The host listens on `\\.\pipe\liza-dos` by default. The included 86Box 5.4
configuration uses legacy serial passthrough in client mode:

```ini
[Ports (COM & LPT)]
serial1_passthrough_enabled = 1
serial2_enabled = 0

[Serial Passthrough Device #1]
mode = 1
named_pipe = \\.\pipe\liza-dos
data_bits = 8
stop_bits = 1
baudrate = 115200
```

For a physical or paired virtual serial port, set `LIZA_PORT` (for example
`COM2`) and optionally `LIZA_BAUD` before running the host.

The host restores the latest Pi conversation from `.liza\sessions`. In
interactive mode, `/NEW` creates a new persistent conversation. Model routing is
fixed in `config\models.json` to OpenRouter model `deepseek/deepseek-v4-pro`
with automatic provider routing and a 384,000-token maximum
output. API keys are read from `OPENROUTER_API_KEY` and `TAVILY_API_KEY` and are not stored here.
LIZA uses Tavily for its explicit web-search and URL-fetch tools.

## DOS client

Build the 16-bit real-mode executable and transfer image:

```powershell
.\tools\build_dos.ps1
```

Mount `dos\LIZA-DOS.img` as a 1.44 MB floppy and copy `LIZA.EXE` to the DOS hard
disk. The image chain-loads the first hard disk when left inserted.

```dos
C:\>LIZA what's your name?
C:\>LIZA
```

With no arguments, LIZA stays in a scrolling interactive session. `/EXIT`
returns to DOS, `/NEW` starts a new conversation, and Esc cancels the active
model turn. Shell commands appear as `[EXEC]`; successful raw output is captured
for Pi and remains hidden. `CD`, drive changes, and `SET` persist until that
particular `LIZA.EXE` process exits.

LIZA retains the most recent 150 display lines. While it is processing a turn,
Up and Down scroll one line, PgUp and PgDn scroll 20 lines, and Home and End
jump to the oldest and newest retained output. New output follows automatically
only while viewing the latest screen.

Each model turn receives the authoritative DOS drive, current directory, client
mode, shell/display constraints, and invocation lifetime. Every shell result
reports the command, directory before and after execution, ERRORLEVEL, complete
captured output, and whether that output is complete. Windows host paths are not
included in the model-visible prompt.

`read_file` reads at most 16 KiB per call with offsets. `write_file` streams up
to 32,767 characters per overwrite or append call and converts line endings to
DOS CRLF. `list_files` returns at most 50 DOS 8.3 entries per page. These tools
exchange chunks over the serial protocol and never access the Windows filesystem.

`compile_c` accepts one strict ANSI C89/C90 translation unit and produces a
16-bit large-model real-mode DOS MZ executable for the 80386. `compile_asm`
accepts Open Watcom WASM MASM-style segmented assembly, not NASM or GAS syntax,
and links a real-mode DOS MZ executable. Both tools use fixed compiler/linker
arguments and transfer the binary to the requested DOS path. Programs run through
`dos_shell`.

Assistant Markdown is rendered incrementally without ANSI.SYS. Version 0.1
styles headings, bold and emphasis, inline and fenced code, lists, task lists,
quotes, horizontal rules, and links using VGA attributes. Links are display-only.
Images, HTML, tables, math, diagrams, and arbitrary CSS are not rendered.

The complete wire specification is in `protocol\PROTOCOL.md`.
