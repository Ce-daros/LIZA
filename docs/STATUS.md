# LIZA 0.1 implementation status

## Complete

- [x] Framed serial protocol with CRC, partial-read handling, resynchronization,
  chunked streams, cancellation, errors, disconnect, and session control
- [x] Windows named-pipe server for 86Box 5.4 and optional physical serial port
- [x] Fresh Pi conversation for every LIZA launch and explicit new-session command
- [x] Xiaomi MiMo V2.5 Pro OpenAI-compatible provider configuration
- [x] MiMo function-calling, structured-output, and reasoning-capable model registration
- [x] OpenRouter DeepSeek V4 Pro provider with runtime effort switching
<!-- generated:tools:start -->
- [x] 7 schema-constrained sequential tools: `dos_shell`, `read_file`, `write_file`, `list_files`, `run_python`, `tavily_search`, `fetch_url`
<!-- generated:tools:end -->
- [x] Sandboxed host-side `run_python` execution with common scientific
  libraries
- [x] Host-side timeout for DOS command and file operations
- [x] Streaming Markdown rendering with tab-aligned tables through direct VGA attributes
- [x] Streamed assistant output and Normal-mode command display filtering
- [x] One-shot `LIZA prompt` DOS mode
- [x] Scrolling interactive `LIZA` DOS mode with `/NEW`, `/EXIT`, and Esc cancel
- [x] Runtime `/MODEL`, `/EFFORT`, and `/STATUS` commands
- [x] 16,384-line XMS-backed display history with Up/Down/PgUp/PgDn/Home/End scrolling
- [x] Synchronous stdout/stderr capture and chunked return without retaining long
  command output in DOS conventional memory
- [x] Per-invocation current directory, drive, and environment persistence
- [x] Temporary capture-file cleanup on success and transport failure
- [x] Clean carrier-loss behavior and host-side rejection of interrupted commands
- [x] Protocol and simulated DOS endpoint tests
- [x] Reproducible Open Watcom real-mode build and FAT12 transfer image
- [x] Bootable-floppy safety chain-loader and documented 86Box configuration

## Verified

- TypeScript strict build
- Automated host/protocol tests
- Pi model registry and persistent session initialization without a model request
- Open Watcom 16-bit DOS compilation
- 1.44 MB FAT12 image size and `55 AA` boot signature
- Bidirectional 86Box named-pipe serial handshake

## Manual integration checks

The final model-backed checks require the running 86Box guest and consume the
configured MiMo account. Run both after copying the rebuilt `LIZA.EXE`:

```dos
LIZA what's your name?
LIZA find the largest text file in this directory
LIZA
```
