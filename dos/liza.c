#include <conio.h>
#include <direct.h>
#include <dos.h>
#include <errno.h>
#include <fcntl.h>
#include <io.h>
#include <i86.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include "protocol.h"
#include "serial.h"
#include "terminal.h"

extern int putenv(const char *);

#define CAPTURE_FILE "LIZAOUT.$$$"

static unsigned char wire[LIZA_MAX_PAYLOAD + 10];
static liza_decoder decoder;
static liza_frame frame;
static unsigned short next_sequence = 1;
static time_t last_host_activity;
static time_t next_ping;
static FILE *active_write_file;
static unsigned short active_write_sequence;
static unsigned short active_write_status;
static unsigned long active_write_bytes;
static int own_status_active;

static void own_status_start(const char *label, const char *detail)
{
    terminal_status_start(label, detail);
    own_status_active = 1;
}

static void own_status_finish(int success)
{
    terminal_status_finish(success);
    own_status_active = 0;
}

static void begin_host_wait(void)
{
    last_host_activity = time(NULL);
    next_ping = last_host_activity + 1;
}

static unsigned short allocate_sequence(void)
{
    unsigned short result = next_sequence++;
    if (next_sequence == 0) next_sequence = 1;
    return result;
}

static int send_at(unsigned char type, unsigned short sequence,
                   const unsigned char *payload, unsigned short length)
{
    unsigned short size = liza_encode(wire, type, sequence, payload, length);
    return serial_write(wire, size);
}

static unsigned short send_new(unsigned char type, const unsigned char *payload,
                               unsigned short length)
{
    unsigned short sequence = allocate_sequence();
    if (!send_at(type, sequence, payload, length)) return 0;
    return sequence;
}

static int poll_frame(void)
{
    while (serial_can_read())
        if (liza_decode_byte(&decoder, serial_read(), &frame)) {
            last_host_activity = time(NULL);
            return 1;
        }
    return 0;
}

static int maintain_link(void)
{
    time_t now = time(NULL);
    if (now >= next_ping) {
        if (!send_at(LIZA_PING, 0, (const unsigned char *)"", 0)) return 0;
        next_ping = now + 1;
    }
    return now - last_host_activity < 10;
}

static int wait_for(unsigned char type, unsigned short sequence, int seconds)
{
    time_t deadline = time(NULL) + seconds;
    begin_host_wait();
    while (time(NULL) < deadline) {
        if (poll_frame() && frame.type == type && frame.sequence == sequence)
            return 1;
        if (!maintain_link()) return 0;
        if (kbhit() && getch() == 27) return 0;
    }
    return 0;
}

static int connect_host(void)
{
    const unsigned char identity[] = "LIZA-DOS/0.1";
    unsigned short sequence = allocate_sequence();
    unsigned short size = liza_encode(wire, LIZA_HELLO, sequence, identity,
                                      sizeof(identity) - 1);
    time_t deadline = time(NULL) + 10;
    time_t retry = 0;

    while (time(NULL) < deadline) {
        if (time(NULL) >= retry) {
            if (!serial_write(wire, size)) return 0;
            retry = time(NULL) + 1;
        }
        if (poll_frame() && frame.type == LIZA_HELLO_ACK &&
            frame.sequence == sequence) return 1;
        if (kbhit() && getch() == 27) return 0;
    }
    return 0;
}

static int start_session(unsigned char mode)
{
    unsigned char payload[1 + LIZA_MAX_PATH_BYTES];
    char cwd[LIZA_MAX_PATH_BYTES];
    unsigned short sequence;
    unsigned short length;

    if (getcwd(cwd, sizeof(cwd)) == NULL) cwd[0] = '\0';
    payload[0] = mode;
    length = (unsigned short)strlen(cwd);
    memcpy(payload + 1, cwd, length);
    sequence = send_new(LIZA_SESSION_START, payload, length + 1);
    return sequence != 0 && wait_for(LIZA_SESSION_READY, sequence, 10);
}

static int same_word(const char *text, const char *word)
{
    while (*word && ((*text | 0x20) == (*word | 0x20))) {
        ++text;
        ++word;
    }
    return *word == '\0' && (*text == '\0' || *text == ' ' || *text == '\t');
}

static char *skip_spaces(char *text)
{
    while (*text == ' ' || *text == '\t') ++text;
    return text;
}

static int same_text(const char *left, const char *right)
{
    while (*left && *right && ((*left | 0x20) == (*right | 0x20))) {
        ++left;
        ++right;
    }
    return *left == '\0' && *right == '\0';
}

static char *unquote(char *text)
{
    unsigned length = strlen(text);
    if (length >= 2 && text[0] == '"' && text[length - 1] == '"') {
        text[length - 1] = '\0';
        return text + 1;
    }
    return text;
}

static int write_capture(const char *message, int result)
{
    FILE *file = fopen(CAPTURE_FILE, "wb");
    if (file == NULL) return 1;
    if (fputs(message, file) == EOF) {
        fclose(file);
        return 1;
    }
    if (fclose(file) != 0) return 1;
    return result;
}

static int execute_state_command(char *command)
{
    char *argument;
    int drive;
    int is_cd;

    is_cd = same_word(command, "CD");
    if (is_cd || same_word(command, "CHDIR")) {
        argument = skip_spaces(command + (is_cd ? 2 : 5));
        if (*argument == '\0') {
            char cwd[80];
            if (getcwd(cwd, sizeof(cwd)) != NULL) {
                FILE *file = fopen(CAPTURE_FILE, "wb");
                if (file != NULL) {
                    fprintf(file, "%s\r\n", cwd);
                    fclose(file);
                    return 0;
                }
            }
            return write_capture("Unable to read current directory.\r\n", 1);
        }
        if (chdir(unquote(argument)) == 0) return write_capture("", 0);
        return write_capture("Invalid directory.\r\n", 1);
    }

    if (same_word(command, "SET")) {
        char *env_line;
        argument = skip_spaces(command + 3);
        if (*argument == '\0') return -1;
        /* putenv keeps the pointer, so the buffer must outlive this call;
           DOS has no clean unsetenv, so the old allocation is leaked. */
        env_line = malloc(strlen(argument) + 1);
        if (env_line == NULL)
            return write_capture("Out of memory.\r\n", 1);
        strcpy(env_line, argument);
        if (putenv(env_line) == 0) return write_capture("", 0);
        return write_capture("Unable to set environment variable.\r\n", 1);
    }

    if (command[0] && command[1] == ':' && command[2] == '\0') {
        drive = (command[0] | 0x20) - 'a' + 1;
        if (drive >= 1 && drive <= 26 && _chdrive(drive) == 0)
            return write_capture("", 0);
        return write_capture("Invalid drive.\r\n", 1);
    }
    return -1;
}

static int execute_captured(char *command)
{
    int output_fd;
    int saved_stdout;
    int saved_stderr;
    int result;

    remove(CAPTURE_FILE);
    result = execute_state_command(command);
    if (result >= 0) return result;

    fflush(stdout);
    fflush(stderr);
    saved_stdout = dup(1);
    saved_stderr = dup(2);
    output_fd = open(CAPTURE_FILE, O_WRONLY | O_CREAT | O_TRUNC | O_BINARY,
                     S_IREAD | S_IWRITE);
    if (saved_stdout < 0 || saved_stderr < 0 || output_fd < 0) {
        if (saved_stdout >= 0) close(saved_stdout);
        if (saved_stderr >= 0) close(saved_stderr);
        if (output_fd >= 0) close(output_fd);
        write_capture("Unable to capture command output.\r\n", 1);
        return 1;
    }
    dup2(output_fd, 1);
    dup2(output_fd, 2);
    close(output_fd);
    result = system(command);
    fflush(stdout);
    fflush(stderr);
    dup2(saved_stdout, 1);
    dup2(saved_stderr, 2);
    close(saved_stdout);
    close(saved_stderr);
    return result;
}

static int return_command_result(unsigned short sequence, char *command)
{
    static const unsigned char lost_message[] =
        "LIZA: unable to read captured output.\r\n";
    FILE *file;
    unsigned char buffer[LIZA_FILE_CHUNK_BYTES];
    unsigned char ending[3 + LIZA_MAX_PATH_BYTES + 1];
    char cwd[LIZA_MAX_PATH_BYTES];
    unsigned short count;
    int result;
    int complete = 1;

    own_status_start("EXEC", command);
    result = execute_captured(command);
    own_status_finish(result == 0);
    begin_host_wait();
    file = fopen(CAPTURE_FILE, "rb");
    if (file != NULL) {
        while ((count = (unsigned short)fread(buffer, 1, sizeof(buffer), file)) != 0)
            if (!send_at(LIZA_EXEC_RESULT_CHUNK, sequence, buffer, count)) {
                fclose(file);
                remove(CAPTURE_FILE);
                return 0;
            }
        fclose(file);
    } else {
        complete = 0;
        if (!send_at(LIZA_EXEC_RESULT_CHUNK, sequence, lost_message,
                     sizeof(lost_message) - 1)) {
            remove(CAPTURE_FILE);
            return 0;
        }
    }
    remove(CAPTURE_FILE);
    ending[0] = result & 0xff;
    ending[1] = (result >> 8) & 0xff;
    ending[2] = (unsigned char)complete;
    if (getcwd(cwd, sizeof(cwd)) == NULL) cwd[0] = '\0';
    count = (unsigned short)strlen(cwd);
    memcpy(ending + 3, cwd, count);
    return send_at(LIZA_EXEC_RESULT_END, sequence, ending, count + 3);
}

static unsigned long read_u32(const unsigned char *data)
{
    return (unsigned long)data[0] |
           ((unsigned long)data[1] << 8) |
           ((unsigned long)data[2] << 16) |
           ((unsigned long)data[3] << 24);
}

static void write_u16(unsigned char *data, unsigned short value)
{
    data[0] = value & 0xff;
    data[1] = value >> 8;
}

static void write_u32(unsigned char *data, unsigned long value)
{
    data[0] = value & 0xff;
    data[1] = (value >> 8) & 0xff;
    data[2] = (value >> 16) & 0xff;
    data[3] = (value >> 24) & 0xff;
}

static void copy_path(char *target, const unsigned char *source,
                      unsigned short length)
{
    memcpy(target, source, length);
    target[length] = '\0';
}

static int handle_read_file(const liza_frame *request)
{
    char path[LIZA_MAX_PATH_BYTES + 1];
    FILE *file;
    unsigned char buffer[LIZA_FILE_CHUNK_BYTES];
    unsigned char ending[7];
    unsigned long offset;
    unsigned long position;
    unsigned long end;
    unsigned short maximum;
    unsigned short count;
    unsigned short wanted;
    unsigned short status = 0;

    if (request->length < 7 || request->length > 6 + LIZA_MAX_PATH_BYTES) return 0;
    offset = read_u32(request->payload);
    maximum = request->payload[4] | ((unsigned short)request->payload[5] << 8);
    copy_path(path, request->payload + 6, request->length - 6);
    own_status_start("READ", path);
    file = fopen(path, "rb");
    if (file == NULL) {
        status = errno;
        position = offset;
        end = offset;
    } else if (fseek(file, (long)offset, SEEK_SET) != 0) {
        status = errno;
        position = offset;
        end = offset;
        fclose(file);
        file = NULL;
    } else {
        while (maximum != 0) {
            wanted = maximum > sizeof(buffer) ? sizeof(buffer) : maximum;
            count = (unsigned short)fread(buffer, 1, wanted, file);
            if (count != 0 && !send_at(LIZA_READ_FILE_CHUNK, request->sequence,
                                       buffer, count)) {
                fclose(file);
                return 0;
            }
            maximum -= count;
            if (count < wanted) break;
        }
        position = (unsigned long)ftell(file);
        fseek(file, 0, SEEK_END);
        end = (unsigned long)ftell(file);
        fclose(file);
    }
    write_u16(ending, status);
    write_u32(ending + 2, position);
    ending[6] = position >= end;
    own_status_finish(status == 0);
    return send_at(LIZA_READ_FILE_END, request->sequence, ending, sizeof(ending));
}

static int handle_write_start(const liza_frame *request)
{
    char path[LIZA_MAX_PATH_BYTES + 1];
    const char *mode;

    if (request->length < 2 || request->length > LIZA_MAX_PATH_BYTES + 1) return 0;
    if (active_write_file != NULL) fclose(active_write_file);
    active_write_file = NULL;
    active_write_sequence = request->sequence;
    active_write_status = 0;
    active_write_bytes = 0;
    copy_path(path, request->payload + 1, request->length - 1);
    if (request->payload[0] == 1) mode = "wb";
    else if (request->payload[0] == 2) mode = "ab";
    else return 0;
    own_status_start("WRITE", path);
    active_write_file = fopen(path, mode);
    if (active_write_file == NULL) active_write_status = errno;
    return 1;
}

static int handle_write_chunk(const liza_frame *request)
{
    unsigned short count;
    if (request->sequence != active_write_sequence) return 0;
    if (active_write_status != 0) return 1;
    if (active_write_file == NULL) return 0;
    count = (unsigned short)fwrite(request->payload, 1, request->length,
                                  active_write_file);
    active_write_bytes += count;
    if (count != request->length) active_write_status = errno;
    return 1;
}

static int handle_write_end(const liza_frame *request)
{
    unsigned char result[6];
    if (request->sequence != active_write_sequence) return 0;
    if (active_write_file != NULL) {
        if (fclose(active_write_file) != 0 && active_write_status == 0)
            active_write_status = errno;
        active_write_file = NULL;
    }
    write_u16(result, active_write_status);
    write_u32(result + 2, active_write_bytes);
    own_status_finish(active_write_status == 0);
    return send_at(LIZA_WRITE_FILE_RESULT, request->sequence, result,
                   sizeof(result));
}

static int handle_list_files(const liza_frame *request)
{
    char directory[LIZA_MAX_PATH_BYTES + 1];
    char pattern[LIZA_MAX_PATH_BYTES + 1];
    char specification[2 * LIZA_MAX_PATH_BYTES + 4];
    char line[96];
    struct find_t found;
    unsigned char ending[5];
    unsigned short cursor;
    unsigned short skipped = 0;
    unsigned short emitted = 0;
    unsigned short status;
    unsigned short result_status = 0;
    unsigned short next;
    unsigned char limit;
    unsigned char directory_length;
    int eof = 0;
    int search_open = 0;
    int length;
    unsigned year, month, day, hour, minute, second;

    if (request->length < 6) return 0;
    cursor = request->payload[0] | ((unsigned short)request->payload[1] << 8);
    limit = request->payload[2];
    directory_length = request->payload[3];
    if (limit == 0 || limit > 50 || directory_length == 0 ||
        4 + directory_length >= request->length || directory_length > LIZA_MAX_PATH_BYTES ||
        request->length - 4 - directory_length > LIZA_MAX_PATH_BYTES) return 0;
    copy_path(directory, request->payload + 4, directory_length);
    copy_path(pattern, request->payload + 4 + directory_length,
              request->length - 4 - directory_length);
    strcpy(specification, directory);
    length = strlen(specification);
    if (length != 0 && specification[length - 1] != '\\' &&
        specification[length - 1] != '/') strcat(specification, "\\");
    strcat(specification, pattern);
    own_status_start("FILES", specification);

    status = _dos_findfirst(specification,
                            _A_RDONLY | _A_HIDDEN | _A_SYSTEM |
                            _A_SUBDIR | _A_ARCH, &found);
    if (status == 0) search_open = 1;
    else if (status != 2 && status != 18) result_status = status;
    while (status == 0 && skipped < cursor) {
        ++skipped;
        status = _dos_findnext(&found);
    }
    while (status == 0 && emitted < limit) {
        year = 1980 + (found.wr_date >> 9);
        month = (found.wr_date >> 5) & 15;
        day = found.wr_date & 31;
        hour = found.wr_time >> 11;
        minute = (found.wr_time >> 5) & 63;
        second = (found.wr_time & 31) * 2;
        length = sprintf(line, "%s\t%lu\t%02X\t%04u-%02u-%02u\t%02u:%02u:%02u\r\n",
                         found.name, found.size, (unsigned char)found.attrib,
                         year, month, day, hour, minute, second);
        if (!send_at(LIZA_LIST_FILES_CHUNK, request->sequence,
                     (const unsigned char *)line, length)) {
            if (search_open) _dos_findclose(&found);
            return 0;
        }
        ++emitted;
        status = _dos_findnext(&found);
    }
    if (search_open && status != 0 && status != 18)
        result_status = status;
    eof = status != 0;
    if (search_open) _dos_findclose(&found);
    next = cursor + emitted;
    write_u16(ending, result_status);
    write_u16(ending + 2, next);
    ending[4] = eof;
    own_status_finish(result_status == 0);
    return send_at(LIZA_LIST_FILES_END, request->sequence, ending,
                   sizeof(ending));
}

static void display_assistant(const unsigned char *text, unsigned short length)
{
    terminal_append(text, length, terminal_color_text(), 1);
}

static void display_styled(unsigned char attribute, const unsigned char *text,
                           unsigned short length)
{
    terminal_append(text, length, attribute, 1);
}

/* Host style bytes carry foreground colors on black; keep the foreground but
   render on the theme background. Quote (white on blue) maps to the theme's
   status color so it stays distinct. */
static unsigned char themed_style(unsigned char style)
{
    if (style == 0x17) return terminal_color_status();
    return (style & 0x0f) | (terminal_color_text() & 0xf0);
}

static void handle_tool_status(const liza_frame *status)
{
    char label[16];
    char detail[TERMINAL_WIDTH + 1];
    unsigned short index;
    unsigned short used = 0;

    if (status->length < 2) return;
    index = 1;
    while (index < status->length && status->payload[index] != '\0' &&
           used + 1 < sizeof(label)) label[used++] = status->payload[index++];
    label[used] = '\0';
    if (index == status->length) return;
    ++index;
    used = 0;
    while (index < status->length && used + 1 < sizeof(detail))
        detail[used++] = status->payload[index++];
    detail[used] = '\0';
    if (status->payload[0] == 0) terminal_status_start(label, detail);
    else if (status->payload[0] == 1 && !own_status_active)
        terminal_status_finish(1);
    else if (status->payload[0] == 2 && !own_status_active)
        terminal_status_finish(0);
}

static int reject_long_command(unsigned short sequence)
{
    static const unsigned char message[] =
        "Command is too long; refused to execute.\r\n";
    unsigned char ending[3 + LIZA_MAX_PATH_BYTES + 1];
    char cwd[LIZA_MAX_PATH_BYTES];
    unsigned short count;

    if (!send_at(LIZA_EXEC_RESULT_CHUNK, sequence, message,
                 sizeof(message) - 1)) return 0;
    ending[0] = 1;
    ending[1] = 0;
    ending[2] = 1;
    if (getcwd(cwd, sizeof(cwd)) == NULL) cwd[0] = '\0';
    count = (unsigned short)strlen(cwd);
    memcpy(ending + 3, cwd, count);
    return send_at(LIZA_EXEC_RESULT_END, sequence, ending, count + 3);
}

static int run_turn(const char *prompt)
{
    unsigned short sequence = allocate_sequence();
    unsigned short length = (unsigned short)strlen(prompt);
    unsigned short offset = 0;
    unsigned short count;
    char command[LIZA_COMMAND_SIZE];
    int cancelled = 0;

    while (offset < length) {
        count = length - offset;
        if (count > LIZA_MAX_PAYLOAD) count = LIZA_MAX_PAYLOAD;
        if (!send_at(LIZA_PROMPT_CHUNK, sequence,
                     (const unsigned char *)prompt + offset, count)) return 0;
        offset += count;
    }
    if (!send_at(LIZA_PROMPT_END, sequence, (const unsigned char *)"", 0)) return 0;
    begin_host_wait();

    for (;;) {
        if (poll_frame()) {
            if (frame.type == LIZA_ASSISTANT_CHUNK && frame.sequence == sequence) {
                display_assistant(frame.payload, frame.length);
            } else if (frame.type == LIZA_STYLED_ASSISTANT_CHUNK &&
                       frame.sequence == sequence && frame.length > 0) {
                display_styled(themed_style(frame.payload[0]), frame.payload + 1,
                               frame.length - 1);
            } else if (frame.type == LIZA_EXEC_REQUEST) {
                if (frame.length > 126) {
                    if (!reject_long_command(frame.sequence)) return 0;
                } else {
                    memcpy(command, frame.payload, frame.length);
                    command[frame.length] = '\0';
                    if (!return_command_result(frame.sequence, command)) return 0;
                }
            } else if (frame.type == LIZA_READ_FILE_REQUEST) {
                if (!handle_read_file(&frame)) return 0;
            } else if (frame.type == LIZA_WRITE_FILE_START) {
                if (!handle_write_start(&frame)) return 0;
            } else if (frame.type == LIZA_WRITE_FILE_CHUNK) {
                if (!handle_write_chunk(&frame)) return 0;
            } else if (frame.type == LIZA_WRITE_FILE_END) {
                if (!handle_write_end(&frame)) return 0;
            } else if (frame.type == LIZA_LIST_FILES_REQUEST) {
                if (!handle_list_files(&frame)) return 0;
            } else if (frame.type == LIZA_TOOL_STATUS && frame.sequence == sequence) {
                handle_tool_status(&frame);
            } else if (frame.type == LIZA_ERROR && frame.sequence == sequence) {
                if (!terminal_at_line_start()) terminal_write("\n");
                terminal_write("LIZA: ");
                display_assistant(frame.payload, frame.length);
                terminal_write("\n");
            } else if (frame.type == LIZA_COMPLETE && frame.sequence == sequence) {
                if (!terminal_at_line_start()) terminal_write("\n");
                return cancelled ? 0 : 1;
            } else if (frame.type == LIZA_DISCONNECT) {
                return 0;
            }
        }
        if (!maintain_link()) return 0;
        terminal_status_update();
        if (kbhit()) {
            int key = getch();
            if (!cancelled && key == 27) {
                if (!send_at(LIZA_CANCEL, sequence, (const unsigned char *)"", 0))
                    return 0;
                cancelled = 1;
            } else {
                terminal_handle_key(key);
            }
        }
    }
}

static int collect_prompt(int argc, char **argv, char *prompt, unsigned size)
{
    int i;
    unsigned used = 0;
    for (i = 1; i < argc; ++i) {
        unsigned length = strlen(argv[i]);
        if (used + length + (i > 1) >= size) return 0;
        if (i > 1) prompt[used++] = ' ';
        memcpy(prompt + used, argv[i], length);
        used += length;
    }
    prompt[used] = '\0';
    return 1;
}

static int read_prompt(char *prompt, unsigned size)
{
    unsigned length = 0;
    unsigned char character;

    for (;;) {
        int key = getch();
        if (key == 0 || key == 0xe0) {
            terminal_handle_key(key);
        } else if (key == '\r') {
            terminal_write("\n");
            prompt[length] = '\0';
            return 1;
        } else if (key == '\b') {
            if (length != 0) {
                --length;
                terminal_backspace();
            }
        } else if (key == 27) {
            while (length != 0) {
                --length;
                terminal_backspace();
            }
        } else if (key >= ' ' && key <= '~' && length + 1 < size) {
            character = (unsigned char)key;
            prompt[length++] = character;
            terminal_append(&character, 1, terminal_color_text(), 1);
        }
    }
}

struct help_topic {
    const char *name;
    const char *detail;
};

static const struct help_topic help_topics[] = {
    { "help",
      "/HELP [command]\n"
      "  Without a command, shows the command overview.\n"
      "  With a command, shows details for that command.\n" },
    { "new",
      "/NEW\n"
      "  Starts a new conversation; previous context is dropped.\n" },
    { "theme",
      "/THEME [name]\n"
      "  Without a name, lists all color themes.\n"
      "  With a name, switches the color theme.\n" },
    { "model",
      "/MODEL [alias]\n"
      "  Without an alias, shows the active model and available aliases.\n"
      "  With an alias, switches the active model.\n" },
    { "effort",
      "/EFFORT [level]\n"
      "  Without a level, shows current and available effort levels.\n"
      "  With a level, switches the reasoning effort.\n" },
    { "status",
      "/STATUS\n"
      "  Shows the current model and reasoning effort.\n" },
    { "exit",
      "/EXIT\n"
      "  Quits LIZA and returns to DOS.\n" },
};

#define HELP_TOPIC_COUNT (sizeof(help_topics) / sizeof(help_topics[0]))

static void help_entry(const char *command, const char *description)
{
    char padded[20];
    unsigned length = strlen(command);

    memset(padded, ' ', sizeof(padded));
    if (length > sizeof(padded) - 1) length = sizeof(padded) - 1;
    memcpy(padded, command, length);
    terminal_write("  ");
    display_styled(terminal_color_accent(), (const unsigned char *)padded,
                   sizeof(padded));
    terminal_write(description);
    terminal_write("\n");
}

static void show_help_overview(void)
{
    display_styled(terminal_color_title(), (const unsigned char *)"Commands\n", 9);
    help_entry("/HELP [command]", "Show help, optionally for a single command");
    help_entry("/NEW", "Start a new conversation");
    help_entry("/THEME [name]", "List color themes or switch to one");
    help_entry("/MODEL [alias]", "Show or switch the active model");
    help_entry("/EFFORT [level]", "Show or switch the reasoning effort");
    help_entry("/STATUS", "Show the current model and effort");
    help_entry("/EXIT", "Quit LIZA");
    display_styled(terminal_color_title(), (const unsigned char *)"Keyboard\n", 9);
    terminal_write("  Up/Down, PgUp/PgDn, Home/End  Scroll output history\n");
    terminal_write("  Esc                           Cancel turn / clear input line\n");
    terminal_write("One-shot mode: LIZA <prompt>\n");
}

static void show_help(char *topic)
{
    unsigned i;

    if (*topic == '\0') {
        show_help_overview();
        return;
    }
    for (i = 0; i < HELP_TOPIC_COUNT; ++i)
        if (same_text(topic, help_topics[i].name)) {
            terminal_write(help_topics[i].detail);
            return;
        }
    display_styled(terminal_color_error(), (const unsigned char *)"LIZA: ", 6);
    terminal_write("no help for '");
    terminal_write(topic);
    terminal_write("'. Run /help to see available commands.\n");
}

static void list_themes(void)
{
    unsigned char i;

    for (i = 0; i < LIZA_THEME_COUNT; ++i) {
        int current = i == terminal_theme_index();
        terminal_write(current ? "* " : "  ");
        display_styled(current ? terminal_color_accent() : terminal_color_text(),
                       (const unsigned char *)liza_themes[i].name,
                       (unsigned short)strlen(liza_themes[i].name));
        terminal_write("\n");
    }
}

static void switch_theme(char *name)
{
    unsigned char i;

    for (i = 0; i < LIZA_THEME_COUNT; ++i)
        if (same_text(name, liza_themes[i].name)) {
            terminal_apply_theme(i);
            display_styled(terminal_color_accent(),
                           (const unsigned char *)"Theme: ", 7);
            terminal_write(liza_themes[i].name);
            terminal_write("\n");
            return;
        }
    display_styled(terminal_color_error(), (const unsigned char *)"LIZA: ", 6);
    terminal_write("unknown theme '");
    terminal_write(name);
    terminal_write("'. Run /theme to list themes.\n");
}

static int start_new_conversation(void)
{
    unsigned short sequence = send_new(LIZA_NEW_SESSION, (const unsigned char *)"", 0);

    if (sequence == 0) return 0;
    begin_host_wait();
    for (;;) {
        if (poll_frame()) {
            if (frame.type == LIZA_ASSISTANT_CHUNK && frame.sequence == sequence)
                display_assistant(frame.payload, frame.length);
            else if (frame.type == LIZA_COMPLETE && frame.sequence == sequence)
                return 1;
            else if (frame.type == LIZA_ERROR && frame.sequence == sequence) {
                terminal_write("LIZA: ");
                display_assistant(frame.payload, frame.length);
                terminal_write("\n");
            }
        }
        if (!maintain_link()) return 0;
    }
}

static int interactive(void)
{
    char prompt[LIZA_PROMPT_SIZE];
    char cwd[80];

    display_styled(terminal_color_title(), (const unsigned char *)"LIZA 0.1", 8);
    terminal_write("  type /HELP for commands\n");
    for (;;) {
        if (getcwd(cwd, sizeof(cwd)) == NULL) cwd[0] = '\0';
        terminal_write("\n");
        display_styled(terminal_color_accent(), (const unsigned char *)"[", 1);
        display_styled(terminal_color_accent(), (const unsigned char *)cwd,
                       (unsigned short)strlen(cwd));
        display_styled(terminal_color_accent(), (const unsigned char *)"] > ", 4);
        if (!read_prompt(prompt, sizeof(prompt))) return 1;
        if (same_word(prompt, "/exit") && *skip_spaces(prompt + 5) == '\0')
            return 1;
        if (same_word(prompt, "/new")) {
            if (!start_new_conversation()) return 0;
            continue;
        }
        if (same_word(prompt, "/help")) {
            show_help(skip_spaces(prompt + 5));
            continue;
        }
        if (same_word(prompt, "/theme")) {
            char *name = skip_spaces(prompt + 6);
            if (*name == '\0') list_themes();
            else switch_theme(name);
            continue;
        }
        if (prompt[0] != '\0' && !run_turn(prompt)) return 0;
    }
}

int main(int argc, char **argv)
{
    char prompt[LIZA_PROMPT_SIZE];
    unsigned char mode = argc > 1 ? LIZA_MODE_ONE_SHOT : LIZA_MODE_INTERACTIVE;
    int ok;

    if (!collect_prompt(argc, argv, prompt, sizeof(prompt))) {
        fprintf(stderr, "LIZA: prompt is too long.\n");
        return 2;
    }
    terminal_apply_theme(LIZA_THEME_DEFAULT);
    terminal_reset();
    if (!serial_open()) {
        terminal_write("LIZA: BIOS reports no COM1 port.\n");
        terminal_restore_theme();
        return 1;
    }
    terminal_write("Connecting to LIZA host...");
    if (!connect_host() || !start_session(mode)) {
        terminal_write(" failed.\nCheck that the Windows host and 86Box COM1 pipe are running.\n");
        terminal_restore_theme();
        return 1;
    }
    begin_host_wait();
    terminal_write(" connected.\n");

    ok = mode == LIZA_MODE_ONE_SHOT ? run_turn(prompt) : interactive();
    if (active_write_file != NULL) {
        fclose(active_write_file);
        active_write_file = NULL;
    }
    send_new(LIZA_DISCONNECT, (const unsigned char *)"", 0);
    terminal_restore_theme();
    return ok ? 0 : 1;
}
