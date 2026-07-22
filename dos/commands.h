#ifndef LIZA_COMMANDS_H
#define LIZA_COMMANDS_H

int commands_same_word(const char *text, const char *word);
char *commands_skip_spaces(char *text);
int commands_same_text(const char *left, const char *right);
int commands_run_turn(const char *prompt);

#endif
