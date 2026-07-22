#include <conio.h>
#include <dos.h>
#include <i86.h>
#include <string.h>
#include "serial.h"
#include "terminal.h"
#include "xms.h"

#define DISPLAY_HEIGHT LIZA_DISPLAY_HEIGHT
#define HISTORY_ROWS LIZA_HISTORY_ROWS
#define ROW_BYTES (TERMINAL_WIDTH * sizeof(unsigned short))
#define HISTORY_KILOBYTES (((unsigned long)HISTORY_ROWS * ROW_BYTES + 1023UL) / 1024UL)

#define STYLE_TEXT 0
#define STYLE_TITLE 1
#define STYLE_ACCENT 2
#define STYLE_STATUS 3
#define STYLE_OK 4
#define STYLE_ERROR 5
#define STYLE_RAW 0x10

static int last_output = '\n';
static unsigned char terminal_attribute;
static unsigned char terminal_original_attribute;
static int terminal_attribute_known;
static unsigned char terminal_theme;
static int terminal_blink_disabled;
static unsigned short terminal_history_handle;
static unsigned short terminal_current[TERMINAL_WIDTH];
static unsigned short terminal_view[DISPLAY_HEIGHT][TERMINAL_WIDTH];
static unsigned long terminal_cursor_row;
static unsigned char terminal_cursor_column;
static unsigned long terminal_view_row;
static int terminal_status_active;
static unsigned long terminal_status_row;
static unsigned char terminal_status_column;
static unsigned char terminal_status_prefix_width;
static unsigned char terminal_status_spinner;
static unsigned long terminal_status_tick;

static unsigned long terminal_oldest_row(void)
{
    if (terminal_cursor_row + 1 > HISTORY_ROWS)
        return terminal_cursor_row + 1 - HISTORY_ROWS;
    return 0;
}

static unsigned long terminal_latest_view_row(void)
{
    if (terminal_cursor_row >= DISPLAY_HEIGHT)
        return terminal_cursor_row - (DISPLAY_HEIGHT - 1);
    return 0;
}

static unsigned long terminal_row_offset(unsigned long row)
{
    return (row % HISTORY_ROWS) * ROW_BYTES;
}

static unsigned char terminal_style(unsigned char attribute)
{
    const liza_theme *theme = &liza_themes[terminal_theme];

    if (attribute == theme->title) return STYLE_TITLE;
    if (attribute == theme->accent) return STYLE_ACCENT;
    if (attribute == theme->status) return STYLE_STATUS;
    if (attribute == theme->ok) return STYLE_OK;
    if (attribute == theme->error) return STYLE_ERROR;
    if (attribute == theme->text) return STYLE_TEXT;
    return STYLE_RAW | (attribute & 0x0f);
}

static unsigned char terminal_style_attribute(unsigned char style)
{
    const liza_theme *theme = &liza_themes[terminal_theme];

    if (style == STYLE_TITLE) return theme->title;
    if (style == STYLE_ACCENT) return theme->accent;
    if (style == STYLE_STATUS) return theme->status;
    if (style == STYLE_OK) return theme->ok;
    if (style == STYLE_ERROR) return theme->error;
    if (style == STYLE_TEXT) return theme->text;
    return (style & 0x0f) | (theme->text & 0xf0);
}

static unsigned short terminal_cell(unsigned char character, unsigned char attribute)
{
    return ((unsigned short)terminal_style(attribute) << 8) | character;
}

static void terminal_clear_current(void)
{
    unsigned column;
    unsigned short cell = terminal_cell(' ', terminal_attribute);

    for (column = 0; column < TERMINAL_WIDTH; ++column) terminal_current[column] = cell;
}

static int terminal_store_current(void)
{
    return xms_write(terminal_history_handle,
                     terminal_row_offset(terminal_cursor_row),
                     (const void __far *)terminal_current, ROW_BYTES);
}

static int terminal_load_row(unsigned long row, unsigned short *destination)
{
    if (row == terminal_cursor_row) {
        memcpy(destination, terminal_current, ROW_BYTES);
        return 1;
    }
    return xms_read(terminal_history_handle, terminal_row_offset(row),
                    (void __far *)destination, ROW_BYTES);
}

static void terminal_set_cursor(unsigned char row, unsigned char column)
{
    union REGS input;
    union REGS output;
    input.h.ah = 0x02;
    input.h.bh = 0;
    input.h.dh = row;
    input.h.dl = column;
    int86(0x10, &input, &output);
}

static void terminal_redraw(void)
{
    volatile unsigned short __far *video;
    unsigned long oldest = terminal_oldest_row();
    unsigned long source_row;
    unsigned short row;
    unsigned short column;
    unsigned short cell;

    video = (volatile unsigned short __far *)MK_FP(0xb800, 0);
    for (row = 0; row < DISPLAY_HEIGHT; ++row) {
        source_row = terminal_view_row + row;
        if (source_row >= oldest && source_row <= terminal_cursor_row)
            terminal_load_row(source_row, terminal_view[row]);
        else {
            unsigned short blank = terminal_cell(' ', terminal_attribute);
            for (column = 0; column < TERMINAL_WIDTH; ++column)
                terminal_view[row][column] = blank;
        }
        for (column = 0; column < TERMINAL_WIDTH; ++column) {
            cell = terminal_view[row][column];
            video[row * TERMINAL_WIDTH + column] =
                ((unsigned short)terminal_style_attribute((unsigned char)(cell >> 8)) << 8) |
                (unsigned char)cell;
        }
    }
    if (terminal_view_row == terminal_latest_view_row())
        terminal_set_cursor((unsigned char)(terminal_cursor_row - terminal_view_row),
                            terminal_cursor_column);
    else
        terminal_set_cursor(DISPLAY_HEIGHT - 1, 0);
}

static void terminal_advance_line(void)
{
    terminal_store_current();
    ++terminal_cursor_row;
    terminal_cursor_column = 0;
    terminal_clear_current();
}

static void terminal_put(unsigned char character, unsigned char color)
{
    unsigned spaces;

    if (character == '\r') {
        terminal_cursor_column = 0;
    } else if (character == '\n') {
        terminal_advance_line();
    } else if (character == '\t') {
        spaces = 8 - (terminal_cursor_column & 7);
        while (spaces-- != 0) terminal_put(' ', color);
    } else {
        terminal_current[terminal_cursor_column] = terminal_cell(character, color);
        ++terminal_cursor_column;
        if (terminal_cursor_column == TERMINAL_WIDTH) terminal_advance_line();
    }
    last_output = character;
}

int terminal_initialize(void)
{
    if (!xms_initialize()) return 0;
    if (!xms_allocate((unsigned short)HISTORY_KILOBYTES, &terminal_history_handle))
        return 0;
    terminal_theme = LIZA_THEME_DEFAULT;
    terminal_attribute = liza_themes[terminal_theme].text;
    terminal_reset();
    return 1;
}

void terminal_shutdown(void)
{
    if (terminal_history_handle != 0) {
        xms_free(terminal_history_handle);
        terminal_history_handle = 0;
    }
}

void terminal_append(const unsigned char *text, unsigned short length,
                     unsigned char color, int redraw)
{
    unsigned short i;
    int follow = terminal_view_row == terminal_latest_view_row();
    int refresh = follow;

    for (i = 0; i < length; ++i) terminal_put(text[i], color);
    if (follow) terminal_view_row = terminal_latest_view_row();
    if (terminal_view_row < terminal_oldest_row()) {
        terminal_view_row = terminal_oldest_row();
        refresh = 1;
    }
    if (redraw && refresh) terminal_redraw();
}

void terminal_write(const char *text)
{
    terminal_append((const unsigned char *)text, (unsigned short)strlen(text),
                    terminal_color_text(), 1);
}

static void terminal_status_replace(unsigned char offset, unsigned char character,
                                    unsigned char color)
{
    unsigned char column = terminal_status_column + offset;

    if (terminal_status_row != terminal_cursor_row || column >= TERMINAL_WIDTH)
        return;
    terminal_current[column] = terminal_cell(character, color);
}

void terminal_status_start(const char *label, const char *detail)
{
    char text[TERMINAL_WIDTH + 1];
    unsigned room;
    unsigned length;

    if (terminal_status_active) return;
    if (last_output != '\n') terminal_write("\n");
    terminal_status_row = terminal_cursor_row;
    terminal_status_column = terminal_cursor_column;
    strcpy(text, "[");
    strcat(text, label);
    strcat(text, "] ");
    terminal_status_prefix_width = strlen(text);
    room = TERMINAL_WIDTH - terminal_status_prefix_width - 3;
    length = strlen(detail);
    if (length > room) length = room;
    strncat(text, detail, length);
    strcat(text, " |");
    terminal_append((const unsigned char *)text, (unsigned short)strlen(text),
                    terminal_color_status(), 1);
    terminal_status_spinner = 0;
    terminal_status_tick = bios_ticks();
    terminal_status_active = 1;
}

void terminal_status_finish(int success)
{
    const char *prefix = success ? "[OK]" : "[FAIL]";
    unsigned char color = success ? terminal_color_ok() : terminal_color_error();
    unsigned i;

    if (!terminal_status_active) return;
    for (i = 0; i < terminal_status_prefix_width; ++i)
        terminal_status_replace(i, i < strlen(prefix) ? prefix[i] : ' ', color);
    terminal_status_replace(terminal_cursor_column - terminal_status_column - 1,
                            ' ', color);
    terminal_status_active = 0;
    terminal_redraw();
    terminal_write("\n");
}

void terminal_status_update(void)
{
    static const char spinner[] = "|/-\\";
    unsigned long ticks;
    unsigned char offset;

    if (!terminal_status_active) return;
    ticks = bios_ticks();
    if (ticks - terminal_status_tick < 3) return;
    terminal_status_tick = ticks;
    terminal_status_spinner = (terminal_status_spinner + 1) & 3;
    offset = terminal_cursor_column - terminal_status_column - 1;
    terminal_status_replace(offset, spinner[terminal_status_spinner],
                            terminal_color_status());
    if (terminal_view_row == terminal_latest_view_row()) terminal_redraw();
}

void terminal_backspace(void)
{
    int follow = terminal_view_row == terminal_latest_view_row();

    if (terminal_cursor_column != 0) {
        --terminal_cursor_column;
    } else if (terminal_cursor_row != 0) {
        --terminal_cursor_row;
        terminal_load_row(terminal_cursor_row, terminal_current);
        terminal_cursor_column = TERMINAL_WIDTH - 1;
    } else {
        return;
    }
    terminal_current[terminal_cursor_column] = terminal_cell(' ', terminal_attribute);
    if (follow) {
        terminal_view_row = terminal_latest_view_row();
        terminal_redraw();
    }
}

void terminal_handle_key(int key)
{
    unsigned long oldest;
    unsigned long latest;
    int scan;

    if (key != 0 && key != 0xe0) return;
    scan = getch();
    oldest = terminal_oldest_row();
    latest = terminal_latest_view_row();
    if (scan == 0x48) {
        if (terminal_view_row > oldest) --terminal_view_row;
    } else if (scan == 0x50) {
        if (terminal_view_row < latest) ++terminal_view_row;
    } else if (scan == 0x49) {
        if (terminal_view_row > oldest + 20) terminal_view_row -= 20;
        else terminal_view_row = oldest;
    } else if (scan == 0x51) {
        if (terminal_view_row + 20 < latest) terminal_view_row += 20;
        else terminal_view_row = latest;
    } else if (scan == 0x47) {
        terminal_view_row = oldest;
    } else if (scan == 0x4f) {
        terminal_view_row = latest;
    } else {
        return;
    }
    terminal_redraw();
}

void terminal_reset(void)
{
    terminal_cursor_row = 0;
    terminal_cursor_column = 0;
    terminal_view_row = 0;
    terminal_status_active = 0;
    last_output = '\n';
    terminal_clear_current();
}

static void terminal_set_blink(int enabled)
{
    union REGS input;
    union REGS output;
    input.x.ax = 0x1003;
    input.h.bl = enabled ? 1 : 0;
    int86(0x10, &input, &output);
}

static void terminal_capture_attribute(void)
{
    union REGS input;
    union REGS output;

    if (terminal_attribute_known) return;
    input.h.ah = 0x08;
    input.h.bh = 0;
    int86(0x10, &input, &output);
    terminal_original_attribute = output.h.ah;
    terminal_attribute_known = 1;
}

void terminal_apply_theme(unsigned char index)
{
    if (index >= LIZA_THEME_COUNT) return;
    terminal_capture_attribute();
    terminal_theme = index;
    terminal_attribute = liza_themes[index].text;
    if (!terminal_blink_disabled) {
        terminal_set_blink(0);
        terminal_blink_disabled = 1;
    }
    terminal_redraw();
}

unsigned char terminal_theme_index(void)
{
    return terminal_theme;
}

void terminal_restore_theme(void)
{
    terminal_attribute = terminal_original_attribute;
    if (terminal_blink_disabled) {
        terminal_set_blink(1);
        terminal_blink_disabled = 0;
    }
    terminal_reset();
    terminal_redraw();
}

unsigned char terminal_color_text(void)
{
    return liza_themes[terminal_theme].text;
}

unsigned char terminal_color_title(void)
{
    return liza_themes[terminal_theme].title;
}

unsigned char terminal_color_accent(void)
{
    return liza_themes[terminal_theme].accent;
}

unsigned char terminal_color_status(void)
{
    return liza_themes[terminal_theme].status;
}

unsigned char terminal_color_ok(void)
{
    return liza_themes[terminal_theme].ok;
}

unsigned char terminal_color_error(void)
{
    return liza_themes[terminal_theme].error;
}

int terminal_at_line_start(void)
{
    return last_output == '\n';
}
