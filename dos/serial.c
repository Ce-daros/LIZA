#include <conio.h>
#include <dos.h>
#include "serial.h"

static unsigned short com_base;

unsigned long bios_ticks(void)
{
    volatile unsigned long __far *ticks;
    ticks = (volatile unsigned long __far *)MK_FP(0x40, 0x6c);
    return *ticks;
}

int serial_open(void)
{
    volatile unsigned short __far *ports;
    ports = (volatile unsigned short __far *)MK_FP(0x40, 0x00);
    com_base = ports[0];
    if (com_base == 0) return 0;
    outp(com_base + 1, 0x00);
    outp(com_base + 3, 0x80);
    outp(com_base + 0, 0x01);
    outp(com_base + 1, 0x00);
    outp(com_base + 3, 0x03);
    outp(com_base + 2, 0xc7);
    outp(com_base + 4, 0x0b);
    inp(com_base + 5);
    inp(com_base);
    return 1;
}

int serial_can_read(void)
{
    return inp(com_base + 5) & 0x01;
}

unsigned char serial_read(void)
{
    return inp(com_base);
}

int serial_write(const unsigned char *data, unsigned short length)
{
    unsigned short i;
    for (i = 0; i < length; ++i) {
        unsigned long started = bios_ticks();
        while (!(inp(com_base + 5) & 0x20))
            if (bios_ticks() - started >= 18) return 0;
        outp(com_base, data[i]);
    }
    return 1;
}
