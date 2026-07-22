#ifndef LIZA_LINK_H
#define LIZA_LINK_H

#include "protocol.h"

extern liza_frame link_frame;

void link_own_status_start(const char *label, const char *detail);
void link_own_status_finish(int success);
void link_begin_host_wait(void);
unsigned short link_allocate_sequence(void);
int link_send_at(unsigned char type, unsigned short sequence,
                 const unsigned char *payload, unsigned short length);
unsigned short link_send_new(unsigned char type, const unsigned char *payload,
                             unsigned short length);
int link_poll_frame(void);
int link_maintain_link(void);
int link_wait_for(unsigned char type, unsigned short sequence, int seconds);
int link_connect_host(void);
int link_start_session(unsigned char mode);

void link_display_assistant(const unsigned char *text, unsigned short length);
void link_display_styled(unsigned char attribute, const unsigned char *text,
                         unsigned short length);
unsigned char link_themed_style(unsigned char style);
void link_handle_tool_status(const liza_frame *status);

#endif
