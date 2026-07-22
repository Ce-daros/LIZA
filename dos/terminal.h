#ifndef LIZA_TERMINAL_H
#define LIZA_TERMINAL_H

#include "proto_gen.h"
#include "themes_gen.h"

#define TERMINAL_WIDTH LIZA_TERMINAL_WIDTH

int terminal_initialize(void);
void terminal_shutdown(void);
void terminal_append(const unsigned char *text, unsigned short length,
                     unsigned char color, int redraw);
void terminal_write(const char *text);
void terminal_status_start(const char *label, const char *detail);
void terminal_status_finish(int success);
void terminal_status_update(void);
void terminal_backspace(void);
void terminal_handle_key(int key);
void terminal_reset(void);
void terminal_apply_theme(unsigned char index);
unsigned char terminal_theme_index(void);
void terminal_restore_theme(void);
unsigned char terminal_color_text(void);
unsigned char terminal_color_title(void);
unsigned char terminal_color_accent(void);
unsigned char terminal_color_status(void);
unsigned char terminal_color_ok(void);
unsigned char terminal_color_error(void);
int terminal_at_line_start(void);

#endif
