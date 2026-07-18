#ifndef LIZA_TERMINAL_H
#define LIZA_TERMINAL_H

#define TERMINAL_WIDTH 80

void terminal_append(const unsigned char *text, unsigned short length,
                     unsigned char color, int redraw);
void terminal_write(const char *text);
void terminal_status_start(const char *label, const char *detail);
void terminal_status_finish(int success);
void terminal_status_update(void);
void terminal_backspace(void);
void terminal_handle_key(int key);
void terminal_reset(void);
void terminal_apply_default_theme(void);
void terminal_restore_theme(void);
unsigned char terminal_color(unsigned char foreground);
int terminal_at_line_start(void);

#endif
