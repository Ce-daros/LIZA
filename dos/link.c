#include <conio.h>
#include <direct.h>
#include <string.h>
#include <time.h>
#include "link.h"
#include "serial.h"
#include "terminal.h"

static unsigned char wire[LIZA_MAX_PAYLOAD + 10];
static liza_decoder decoder;
liza_frame link_frame;
static unsigned short next_sequence = 1;
static time_t last_host_activity;
static time_t next_ping;
static int own_status_active;

void link_own_status_start(const char *label, const char *detail)
{
    terminal_status_start(label, detail);
    own_status_active = 1;
}

void link_own_status_finish(int success)
{
    terminal_status_finish(success);
    own_status_active = 0;
}

void link_begin_host_wait(void)
{
    last_host_activity = time(NULL);
    next_ping = last_host_activity + 1;
}

unsigned short link_allocate_sequence(void)
{
    unsigned short result = next_sequence++;
    if (next_sequence == 0) next_sequence = 1;
    return result;
}

int link_send_at(unsigned char type, unsigned short sequence,
                 const unsigned char *payload, unsigned short length)
{
    unsigned short size = liza_encode(wire, type, sequence, payload, length);
    return serial_write(wire, size);
}

unsigned short link_send_new(unsigned char type, const unsigned char *payload,
                             unsigned short length)
{
    unsigned short sequence = link_allocate_sequence();
    if (!link_send_at(type, sequence, payload, length)) return 0;
    return sequence;
}

int link_poll_frame(void)
{
    while (serial_can_read())
        if (liza_decode_byte(&decoder, serial_read(), &link_frame)) {
            last_host_activity = time(NULL);
            return 1;
        }
    return 0;
}

int link_maintain_link(void)
{
    time_t now = time(NULL);
    if (now >= next_ping) {
        if (!link_send_at(LIZA_PING, 0, (const unsigned char *)"", 0)) return 0;
        next_ping = now + 1;
    }
    return now - last_host_activity < 10;
}

int link_wait_for(unsigned char type, unsigned short sequence, int seconds)
{
    time_t deadline = time(NULL) + seconds;
    link_begin_host_wait();
    while (time(NULL) < deadline) {
        if (link_poll_frame() && link_frame.type == type &&
            link_frame.sequence == sequence)
            return 1;
        if (!link_maintain_link()) return 0;
        if (kbhit() && getch() == 27) return 0;
    }
    return 0;
}

int link_connect_host(void)
{
    const unsigned char identity[] = "LIZA-DOS/0.1";
    unsigned short sequence = link_allocate_sequence();
    unsigned short size = liza_encode(wire, LIZA_HELLO, sequence, identity,
                                      sizeof(identity) - 1);
    time_t deadline = time(NULL) + 10;
    time_t retry = 0;

    while (time(NULL) < deadline) {
        if (time(NULL) >= retry) {
            if (!serial_write(wire, size)) return 0;
            retry = time(NULL) + 1;
        }
        if (link_poll_frame() && link_frame.type == LIZA_HELLO_ACK &&
            link_frame.sequence == sequence) return 1;
        if (kbhit() && getch() == 27) return 0;
    }
    return 0;
}

int link_start_session(unsigned char mode)
{
    unsigned char payload[1 + LIZA_MAX_PATH_BYTES];
    char cwd[LIZA_MAX_PATH_BYTES];
    unsigned short sequence;
    unsigned short length;

    if (getcwd(cwd, sizeof(cwd)) == NULL) cwd[0] = '\0';
    payload[0] = mode;
    length = (unsigned short)strlen(cwd);
    memcpy(payload + 1, cwd, length);
    sequence = link_send_new(LIZA_SESSION_START, payload, length + 1);
    return sequence != 0 && link_wait_for(LIZA_SESSION_READY, sequence, 10);
}

void link_display_assistant(const unsigned char *text, unsigned short length)
{
    terminal_append(text, length, terminal_color_text(), 1);
}

void link_display_styled(unsigned char attribute, const unsigned char *text,
                         unsigned short length)
{
    terminal_append(text, length, attribute, 1);
}

/* Host style bytes carry foreground colors on black; keep the foreground but
   render on the theme background. Quote (white on blue) maps to the theme's
   status color so it stays distinct. */
unsigned char link_themed_style(unsigned char style)
{
    if (style == 0x17) return terminal_color_status();
    return (style & 0x0f) | (terminal_color_text() & 0xf0);
}

void link_handle_tool_status(const liza_frame *status)
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
