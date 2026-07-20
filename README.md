# LIZA

<img width="2164" height="1344" alt="image" src="https://github.com/user-attachments/assets/8eed798e-1eef-4332-be59-fb83d64806de" />

LIZA is a thin MS-DOS 6.22 client for a persistent Pi agent running on Windows.
<!-- generated:tools:start -->
The DOS program displays the conversation and exposes 7 sequential tools:
`dos_shell`, `read_file`, `write_file`, `list_files`, `run_python`, `tavily_search`, `fetch_url`.
<!-- generated:tools:end -->
File and shell operations occur on the
guest. Python runs in a sandboxed process on the Windows host.

## Requirements

- Windows 11 and 86Box 5.4
- Node.js 22.19 or newer
- Open Watcom 16-bit DOS compiler at `C:\WATCOM16` (to build the DOS client)
- Python 3 on `PATH` for `run_python` (NumPy, SciPy, pandas, Matplotlib, SymPy)
- MS-DOS 6.22 guest with an emulated COM1 connection
- `MIMO_API_KEY` in the host environment
- `OPENROUTER_API_KEY` in the host environment to use `/MODEL ds`
- `TAVILY_API_KEY` in the host environment for web search and URL fetching

## Host

```powershell
npm install
Copy-Item .env.example .env
npm run check
npm run host
```

Set the required API keys in `.env`; the file is ignored by Git. Existing
process environment variables take precedence over values loaded from it.

The host listens on `\\.\pipe\liza-dos` by default. The included 86Box 5.4
configuration uses legacy serial passthrough in client mode:

```ini
[Ports (COM & LPT)]
serial1_passthrough_enabled = 1

[Serial Passthrough Device #1]
mode = 1
named_pipe = \\.\pipe\liza-dos
data_bits = 8
stop_bits = 1
baudrate = 115200
```

For a physical or paired virtual serial port, set `LIZA_PORT` (for example
`COM2`) and optionally `LIZA_BAUD` before running the host.

Each LIZA launch creates a new Pi conversation in `.liza\sessions`; no earlier
conversation is resumed. In interactive mode, `/NEW` creates another new
conversation. The configured MiMo model is `mimo-v2.5-pro`; its limits are
defined in `config\models.json`. The optional DeepSeek alias uses OpenRouter.
API keys are read from `MIMO_API_KEY`, `OPENROUTER_API_KEY`, and
`TAVILY_API_KEY` and are not stored here. LIZA uses
Tavily for explicit web search and URL fetching.
MiMo V2.5 Pro uses its OpenAI-compatible endpoint; function calling and
reasoning-content replay are enabled for LIZA's tools. The model also supports
JSON structured output when a future tool needs it.

## DOS client

Build the 16-bit real-mode executable and transfer image:

```powershell
npm run build:dos
```

Mount `dos\LIZA-DOS.img` as a 1.44 MB floppy and copy `LIZA.EXE` to the DOS hard
disk. The image chain-loads the first hard disk when left inserted.

```dos
C:\>LIZA what's your name?
C:\>LIZA
```

With no arguments, LIZA stays in a scrolling interactive session. `/EXIT`
returns to DOS, `/NEW` starts a new conversation, `/THEME` reapplies the default
theme, `/MODEL` displays the aliases `mimo` and `ds`; use `/MODEL mimo` or
`/MODEL ds` to select one. `/EFFORT` displays or sets the active model's
reasoning level (`off` or `high` for MiMo; `off`, `high`, or `xhigh` for
DeepSeek), `/STATUS` displays the active model and effort, and Esc cancels
the active model turn. Successful command output is
captured for Pi and remains hidden. `CD`, drive changes, and `SET` persist until
that particular `LIZA.EXE` process exits.

LIZA retains the most recent 150 display lines. Up and Down scroll one line,
PgUp and PgDn scroll 20 lines, and Home and End jump to the oldest and newest
retained output. New output follows automatically only while viewing the latest
screen.

Each model turn receives the authoritative DOS drive, current directory, client
mode, shell/display constraints, and invocation lifetime. Every shell result
reports the command, directory before and after execution, ERRORLEVEL, complete
captured output, and whether that output is complete. Windows host paths are not
included in the model-visible prompt.

`read_file` reads at most 16 KiB per call with offsets. `write_file` streams up
to 32,767 characters per overwrite or append call and converts line endings to
DOS CRLF. `list_files` returns at most 50 DOS 8.3 entries per page. These tools
exchange chunks over the serial protocol and never access the Windows filesystem.

`run_python` executes Python 3 source on the Windows host in a fresh temporary
directory with a scrubbed environment — host variables such as API keys are not
visible — and a bounded runtime, returning stdout, stderr, and the exit code as
text. NumPy, SciPy, pandas, Matplotlib, and SymPy are available.

Assistant Markdown is rendered incrementally without ANSI.SYS. The default
LIZA theme uses a black background; `/THEME` and `/THEME DEFAULT` apply it.
Tool activity stays on one line: `[EXEC]`, `[READ]`, `[WRITE]`, `[FILES]`,
`[SEARCH]`, `[FETCH]`, and `[PYTHON]` animate while running and become `[OK]`
or `[FAIL]` when complete. Version 0.1 styles headings, bold and emphasis,
inline and fenced code, lists, task lists, quotes, horizontal rules, and links
using VGA attributes. Links are display-only. Images, HTML, tables, math,
diagrams, and arbitrary CSS are not rendered.

The complete wire specification is in `protocol\PROTOCOL.md`.
