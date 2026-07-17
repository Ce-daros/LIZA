# LIZA Serial Protocol

Version 1 is a framed, bidirectional protocol over the emulated COM link. Numeric
fields are little-endian. Text sent by the DOS client is ASCII; host output is
converted to printable DOS-safe ASCII before transmission.

## Frame format

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 2 | sync bytes `4C 5A` (`LZ`) |
| 2 | 1 | version (`01`) |
| 3 | 1 | message type |
| 4 | 2 | sequence number |
| 6 | 2 | payload length, at most 1024 |
| 8 | n | payload |
| 8+n | 2 | CRC-16/CCITT-FALSE over bytes 2 through 7+n |

CRC uses polynomial `0x1021`, initial value `0xFFFF`, no reflection, and no
final XOR. A sequence identifies a logical prompt or shell request. All chunks
belonging to that operation use the same sequence.

## Messages

<!-- generated:messages:start -->
| Value | Name | Direction | Payload |
| ---: | --- | --- | --- |
| 1 | `HELLO` | DOS to host | client identifier |
| 2 | `HELLO_ACK` | host to DOS | server identifier; same sequence |
| 3 | `TEXT` | either | reserved Phase 1 diagnostic |
| 4 | `ERROR` | either | compact error text |
| 5 | `DISCONNECT` | either | empty |
| 6 | `SESSION_START` | DOS to host | mode byte followed by current directory |
| 7 | `PROMPT_CHUNK` | DOS to host | prompt bytes |
| 8 | `PROMPT_END` | DOS to host | empty |
| 9 | `ASSISTANT_CHUNK` | host to DOS | streamed answer bytes |
| 10 | `EXEC_REQUEST` | host to DOS | one DOS command, maximum 126 bytes |
| 11 | `EXEC_RESULT_CHUNK` | DOS to host | captured stdout/stderr bytes |
| 12 | `EXEC_RESULT_END` | DOS to host | signed 16-bit exit code followed by current DOS directory |
| 13 | `COMPLETE` | host to DOS | empty |
| 14 | `CANCEL` | DOS to host | empty; prompt sequence |
| 15 | `NEW_SESSION` | DOS to host | empty |
| 16 | `SESSION_READY` | host to DOS | empty; session-start sequence |
| 17 | `PING` | DOS to host | empty; sequence zero |
| 18 | `PONG` | host to DOS | empty; same sequence |
| 19 | `READ_FILE_REQUEST` | host to DOS | offset, maximum byte count, and DOS path |
| 20 | `READ_FILE_CHUNK` | DOS to host | file content bytes |
| 21 | `READ_FILE_END` | DOS to host | status, next offset, and EOF flag |
| 22 | `WRITE_FILE_START` | host to DOS | overwrite/append mode and DOS path |
| 23 | `WRITE_FILE_CHUNK` | host to DOS | file content bytes |
| 24 | `WRITE_FILE_END` | host to DOS | empty |
| 25 | `WRITE_FILE_RESULT` | DOS to host | status and bytes written |
| 26 | `LIST_FILES_REQUEST` | host to DOS | cursor, limit, directory, and 8.3 pattern |
| 27 | `LIST_FILES_CHUNK` | DOS to host | tab-separated directory entries |
| 28 | `LIST_FILES_END` | DOS to host | status, next cursor, and EOF flag |
| 29 | `STYLED_ASSISTANT_CHUNK` | host to DOS | style color byte followed by text |
| 30 | `TOOL_STATUS` | host to DOS | state byte, ASCII label, NUL, optional detail |
<!-- generated:messages:end -->

Session mode 1 is one-shot and mode 2 is interactive. A prompt consists of zero
or more `PROMPT_CHUNK` frames followed by `PROMPT_END`. During the resulting
agent turn the host may interleave assistant chunks and sequential shell
requests. `COMPLETE` ends the turn.

The DOS side shows each execution request as `[EXEC] command`, captures both
standard streams, hides captured text from the screen, sends every result chunk,
then sends `EXEC_RESULT_END` with the resulting directory. The host returns the
command, directory before and after execution, exit code, completeness marker,
and captured output to Pi. It does not issue another shell request until the
current result is complete.

File reads are bounded to 16 KiB per operation. File writes contain at most
32,767 input characters and are divided into 512-byte transport chunks. Directory
pages contain at most 50 entries. DOS processes every file operation
sequentially and streams content directly between the UART and disk.

### File payloads

`READ_FILE_REQUEST` contains a 32-bit offset, a 16-bit maximum byte count, then
the ASCII path. `READ_FILE_END` contains a signed 16-bit status, 32-bit next
offset, and one-byte EOF flag.

`WRITE_FILE_START` begins with mode 1 for overwrite or 2 for append, followed by
the ASCII path. Zero or more `WRITE_FILE_CHUNK` frames follow, terminated by
`WRITE_FILE_END`. `WRITE_FILE_RESULT` contains a signed 16-bit status and 32-bit
number of bytes written. Text is converted to DOS-safe ASCII with CRLF line
endings before transmission.

`LIST_FILES_REQUEST` contains a 16-bit cursor, one-byte limit, one-byte directory
length, the directory bytes, then the pattern bytes. Each listing line contains
name, size, attribute byte, date, and time separated by tabs. `LIST_FILES_END`
contains a signed 16-bit status, 16-bit next cursor, and one-byte EOF flag.

`STYLED_ASSISTANT_CHUNK` uses the low four bits of the first payload byte as a VGA
foreground color. `07` is normal text and preserves the current console attribute;
other styles preserve the current console background. The host uses bright yellow
for headings, bright cyan for strong text and links, bright green for emphasis and
code, and light gray for quotes. Remaining bytes are DOS-safe ASCII. The DOS client
writes these spans through BIOS video services, performs 80-column wrapping and
25-row scrolling, and does not require ANSI.SYS. Markdown parsing remains entirely
on the host.

`TOOL_STATUS` has state `0` while a host-side tool is running, `1` when it
succeeds, and `2` when it fails. The DOS client displays it as a single
in-place status line with a four-frame spinner, then replaces its prefix with
`[OK]` or `[FAIL]`. DOS-local shell and file requests use the same display
locally without sending this frame.

## Recovery

- Discard bytes before a valid sync pair.
- Reject unsupported versions, payloads over 1024 bytes, and CRC mismatches;
  resume scanning one byte after the candidate sync.
- Retain partial candidates until more serial bytes arrive.
- Reject pending shell operations when the link closes.
- A new DOS process always performs `HELLO` and `SESSION_START`; it never relies
  on transport state left by a previous process.
- The DOS client sends `PING` while waiting and exits after ten seconds without
  any valid host frame. This avoids relying on unstable emulated modem signals.

## Fixed examples

```text
HELLO seq=1 payload="LIZA-DOS/0.1"
4c5a010101000c004c495a412d444f532f302e314068

TEXT seq=2 payload="hello"
4c5a01030200050068656c6c6f2bc1
```
