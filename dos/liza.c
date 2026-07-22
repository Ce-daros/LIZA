#include <conio.h>
#include <direct.h>
#include <stdio.h>
#include <string.h>
#include "commands.h"
#include "files.h"
#include "link.h"
#include "serial.h"
#include "terminal.h"

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
    { "sessions",
      "/SESSIONS\n"
      "  Lists saved conversations.\n" },
    { "resume",
      "/RESUME <session-id>\n"
      "  Opens a saved conversation by its displayed ID.\n" },
    { "rename",
      "/RENAME <name>\n"
      "  Names the active conversation.\n" },
    { "delete",
      "/DELETE <session-id>\n"
      "  Deletes a saved conversation. The active one cannot be deleted.\n" },
    { "export",
      "/EXPORT <path>\n"
      "  Writes the active conversation to a DOS text file.\n" },
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
    link_display_styled(terminal_color_accent(), (const unsigned char *)padded,
                        sizeof(padded));
    terminal_write(description);
    terminal_write("\n");
}

static void show_help_overview(void)
{
    link_display_styled(terminal_color_title(),
                        (const unsigned char *)"Commands\n", 9);
    help_entry("/HELP [command]", "Show help, optionally for a single command");
    help_entry("/NEW", "Start a new conversation");
    help_entry("/SESSIONS", "List saved conversations");
    help_entry("/RESUME <id>", "Open a saved conversation");
    help_entry("/RENAME <name>", "Name the active conversation");
    help_entry("/DELETE <id>", "Delete a saved conversation");
    help_entry("/EXPORT <path>", "Save the conversation as text");
    help_entry("/THEME [name]", "List color themes or switch to one");
    help_entry("/MODEL [alias]", "Show or switch the active model");
    help_entry("/EFFORT [level]", "Show or switch the reasoning effort");
    help_entry("/STATUS", "Show the current model and effort");
    help_entry("/EXIT", "Quit LIZA");
    link_display_styled(terminal_color_title(),
                        (const unsigned char *)"Keyboard\n", 9);
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
        if (commands_same_text(topic, help_topics[i].name)) {
            terminal_write(help_topics[i].detail);
            return;
        }
    link_display_styled(terminal_color_error(), (const unsigned char *)"LIZA: ",
                        6);
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
        link_display_styled(
            current ? terminal_color_accent() : terminal_color_text(),
            (const unsigned char *)liza_themes[i].name,
            (unsigned short)strlen(liza_themes[i].name));
        terminal_write("\n");
    }
}

static void switch_theme(char *name)
{
    unsigned char i;

    for (i = 0; i < LIZA_THEME_COUNT; ++i)
        if (commands_same_text(name, liza_themes[i].name)) {
            terminal_apply_theme(i);
            link_display_styled(terminal_color_accent(),
                                (const unsigned char *)"Theme: ", 7);
            terminal_write(liza_themes[i].name);
            terminal_write("\n");
            return;
        }
    link_display_styled(terminal_color_error(), (const unsigned char *)"LIZA: ",
                        6);
    terminal_write("unknown theme '");
    terminal_write(name);
    terminal_write("'. Run /theme to list themes.\n");
}

static int start_new_conversation(void)
{
    unsigned short sequence =
        link_send_new(LIZA_NEW_SESSION, (const unsigned char *)"", 0);

    if (sequence == 0) return 0;
    link_begin_host_wait();
    for (;;) {
        if (link_poll_frame()) {
            if (link_frame.type == LIZA_ASSISTANT_CHUNK &&
                link_frame.sequence == sequence)
                link_display_assistant(link_frame.payload, link_frame.length);
            else if (link_frame.type == LIZA_COMPLETE &&
                     link_frame.sequence == sequence)
                return 1;
            else if (link_frame.type == LIZA_ERROR &&
                     link_frame.sequence == sequence) {
                terminal_write("LIZA: ");
                link_display_assistant(link_frame.payload, link_frame.length);
                terminal_write("\n");
            }
        }
        if (!link_maintain_link()) return 0;
    }
}

static int interactive(void)
{
    char prompt[LIZA_PROMPT_SIZE];
    char cwd[80];

    link_display_styled(terminal_color_title(),
                        (const unsigned char *)"LIZA 0.1", 8);
    terminal_write("  type /HELP for commands\n");
    for (;;) {
        if (getcwd(cwd, sizeof(cwd)) == NULL) cwd[0] = '\0';
        terminal_write("\n");
        link_display_styled(terminal_color_accent(),
                            (const unsigned char *)"[", 1);
        link_display_styled(terminal_color_accent(), (const unsigned char *)cwd,
                            (unsigned short)strlen(cwd));
        link_display_styled(terminal_color_accent(),
                            (const unsigned char *)"] > ", 4);
        if (!read_prompt(prompt, sizeof(prompt))) return 1;
        if (commands_same_word(prompt, "/exit") &&
            *commands_skip_spaces(prompt + 5) == '\0')
            return 1;
        if (commands_same_word(prompt, "/new")) {
            if (!start_new_conversation()) return 0;
            continue;
        }
        if (commands_same_word(prompt, "/help")) {
            show_help(commands_skip_spaces(prompt + 5));
            continue;
        }
        if (commands_same_word(prompt, "/theme")) {
            char *name = commands_skip_spaces(prompt + 6);
            if (*name == '\0') list_themes();
            else switch_theme(name);
            continue;
        }
        if (prompt[0] != '\0' && !commands_run_turn(prompt)) return 0;
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
    if (!terminal_initialize()) {
        fputs("LIZA: XMS memory manager (HIMEM.SYS) is required.\n", stderr);
        return 1;
    }
    terminal_apply_theme(LIZA_THEME_DEFAULT);
    terminal_reset();
    if (!serial_open()) {
        terminal_write("LIZA: BIOS reports no COM1 port.\n");
        terminal_restore_theme();
        terminal_shutdown();
        return 1;
    }
    terminal_write("Connecting to LIZA host...");
    if (!link_connect_host() || !link_start_session(mode)) {
        terminal_write(" failed.\nCheck that the Windows host and 86Box COM1 pipe are running.\n");
        terminal_restore_theme();
        terminal_shutdown();
        return 1;
    }
    link_begin_host_wait();
    terminal_write(" connected.\n");

    ok = mode == LIZA_MODE_ONE_SHOT ? commands_run_turn(prompt) : interactive();
    files_abort_write();
    link_send_new(LIZA_DISCONNECT, (const unsigned char *)"", 0);
    terminal_restore_theme();
    terminal_shutdown();
    return ok ? 0 : 1;
}
