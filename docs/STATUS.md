# LIZA 0.1 implementation status

## Complete

- [x] Framed serial protocol with CRC, partial-read handling, resynchronization,
  chunked streams, cancellation, errors, disconnect, and session control
- [x] Windows named-pipe server for 86Box 5.4 and optional physical serial port
- [x] Persistent Pi conversation sessions and explicit new-session command
- [x] OpenRouter DeepSeek V4 Pro configuration with automatic provider routing
- [x] Provider-default reasoning and high maximum output token configuration
- [x] Six schema-constrained sequential tools: `dos_shell`, `read_file`,
  `write_file`, `list_files`, `compile_c`, and `compile_asm`
- [x] Strict C89/C90 and WASM/MASM-style real-mode DOS cross-compilation
- [x] Streaming line-level Markdown rendering through direct VGA attributes
- [x] Streamed assistant output and Normal-mode command display filtering
- [x] One-shot `LIZA prompt` DOS mode
- [x] Scrolling interactive `LIZA` DOS mode with `/NEW`, `/EXIT`, and Esc cancel
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
- 20 automated host/protocol tests, including real C and assembly builds
- Pi model registry and persistent session initialization without a model request
- Open Watcom 16-bit DOS compilation
- 1.44 MB FAT12 image size and `55 AA` boot signature
- Bidirectional 86Box named-pipe serial handshake

## Manual integration checks

The final model-backed checks require the running 86Box guest and consume the
configured OpenRouter account. Run both after copying the rebuilt `LIZA.EXE`:

```dos
LIZA what's your name?
LIZA find the largest text file in this directory
LIZA
```
