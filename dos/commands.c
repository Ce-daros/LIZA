#include <conio.h>
#include <direct.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include "commands.h"
#include "files.h"
#include "link.h"
#include "terminal.h"

extern int putenv(const char *);

#define CAPTURE_FILE "LIZAOUT.$$$"

int commands_same_word(const char *text, const char *word)
{
    while (*word && ((*text | 0x20) == (*word | 0x20))) {
        ++text;
        ++word;
    }
    return *word == '\0' && (*text == '\0' || *text == ' ' || *text == '\t');
}

char *commands_skip_spaces(char *text)
{
    while (*text == ' ' || *text == '\t') ++text;
    return text;
}

int commands_same_text(const char *left, const char *right)
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

    is_cd = commands_same_word(command, "CD");
    if (is_cd || commands_same_word(command, "CHDIR")) {
        argument = commands_skip_spaces(command + (is_cd ? 2 : 5));
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

    if (commands_same_word(command, "SET")) {
        char *env_line;
        argument = commands_skip_spaces(command + 3);
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

    link_own_status_start("EXEC", command);
    result = execute_captured(command);
    link_own_status_finish(result == 0);
    link_begin_host_wait();
    file = fopen(CAPTURE_FILE, "rb");
    if (file != NULL) {
        while ((count = (unsigned short)fread(buffer, 1, sizeof(buffer), file)) != 0)
            if (!link_send_at(LIZA_EXEC_RESULT_CHUNK, sequence, buffer, count)) {
                fclose(file);
                remove(CAPTURE_FILE);
                return 0;
            }
        fclose(file);
    } else {
        complete = 0;
        if (!link_send_at(LIZA_EXEC_RESULT_CHUNK, sequence, lost_message,
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
    return link_send_at(LIZA_EXEC_RESULT_END, sequence, ending, count + 3);
}

static int reject_long_command(unsigned short sequence)
{
    static const unsigned char message[] =
        "Command is too long; refused to execute.\r\n";
    unsigned char ending[3 + LIZA_MAX_PATH_BYTES + 1];
    char cwd[LIZA_MAX_PATH_BYTES];
    unsigned short count;

    if (!link_send_at(LIZA_EXEC_RESULT_CHUNK, sequence, message,
                      sizeof(message) - 1)) return 0;
    ending[0] = 1;
    ending[1] = 0;
    ending[2] = 1;
    if (getcwd(cwd, sizeof(cwd)) == NULL) cwd[0] = '\0';
    count = (unsigned short)strlen(cwd);
    memcpy(ending + 3, cwd, count);
    return link_send_at(LIZA_EXEC_RESULT_END, sequence, ending, count + 3);
}

int commands_run_turn(const char *prompt)
{
    unsigned short sequence = link_allocate_sequence();
    unsigned short length = (unsigned short)strlen(prompt);
    unsigned short offset = 0;
    unsigned short count;
    char command[LIZA_COMMAND_SIZE];
    int cancelled = 0;

    while (offset < length) {
        count = length - offset;
        if (count > LIZA_MAX_PAYLOAD) count = LIZA_MAX_PAYLOAD;
        if (!link_send_at(LIZA_PROMPT_CHUNK, sequence,
                          (const unsigned char *)prompt + offset, count)) return 0;
        offset += count;
    }
    if (!link_send_at(LIZA_PROMPT_END, sequence, (const unsigned char *)"", 0))
        return 0;
    link_begin_host_wait();

    for (;;) {
        if (link_poll_frame()) {
            if (link_frame.type == LIZA_ASSISTANT_CHUNK &&
                link_frame.sequence == sequence) {
                link_display_assistant(link_frame.payload, link_frame.length);
            } else if (link_frame.type == LIZA_STYLED_ASSISTANT_CHUNK &&
                       link_frame.sequence == sequence && link_frame.length > 0) {
                link_display_styled(link_themed_style(link_frame.payload[0]),
                                    link_frame.payload + 1,
                                    link_frame.length - 1);
            } else if (link_frame.type == LIZA_EXEC_REQUEST) {
                if (link_frame.length > 126) {
                    if (!reject_long_command(link_frame.sequence)) return 0;
                } else {
                    memcpy(command, link_frame.payload, link_frame.length);
                    command[link_frame.length] = '\0';
                    if (!return_command_result(link_frame.sequence, command))
                        return 0;
                }
            } else if (link_frame.type == LIZA_READ_FILE_REQUEST) {
                if (!files_handle_read(&link_frame)) return 0;
            } else if (link_frame.type == LIZA_WRITE_FILE_START) {
                if (!files_handle_write_start(&link_frame)) return 0;
            } else if (link_frame.type == LIZA_WRITE_FILE_CHUNK) {
                if (!files_handle_write_chunk(&link_frame)) return 0;
            } else if (link_frame.type == LIZA_WRITE_FILE_END) {
                if (!files_handle_write_end(&link_frame)) return 0;
            } else if (link_frame.type == LIZA_LIST_FILES_REQUEST) {
                if (!files_handle_list(&link_frame)) return 0;
            } else if (link_frame.type == LIZA_TOOL_STATUS &&
                       link_frame.sequence == sequence) {
                link_handle_tool_status(&link_frame);
            } else if (link_frame.type == LIZA_ERROR &&
                       link_frame.sequence == sequence) {
                if (!terminal_at_line_start()) terminal_write("\n");
                terminal_write("LIZA: ");
                link_display_assistant(link_frame.payload, link_frame.length);
                terminal_write("\n");
            } else if (link_frame.type == LIZA_COMPLETE &&
                       link_frame.sequence == sequence) {
                if (!terminal_at_line_start()) terminal_write("\n");
                return cancelled ? 0 : 1;
            } else if (link_frame.type == LIZA_DISCONNECT) {
                return 0;
            }
        }
        if (!link_maintain_link()) return 0;
        terminal_status_update();
        if (kbhit()) {
            int key = getch();
            if (!cancelled && key == 27) {
                if (!link_send_at(LIZA_CANCEL, sequence,
                                  (const unsigned char *)"", 0))
                    return 0;
                cancelled = 1;
            } else {
                terminal_handle_key(key);
            }
        }
    }
}
