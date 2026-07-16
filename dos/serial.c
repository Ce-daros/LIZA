#include <conio.h>
#include <time.h>
#include "serial.h"

#define COM1 0x3f8

void serial_open(void)
{
    outp(COM1 + 1, 0x00);
    outp(COM1 + 3, 0x80);
    outp(COM1 + 0, 0x01);
    outp(COM1 + 1, 0x00);
    outp(COM1 + 3, 0x03);
    outp(COM1 + 2, 0xc7);
    outp(COM1 + 4, 0x0b);
}

int serial_can_read(void)
{
    return inp(COM1 + 5) & 0x01;
}

unsigned char serial_read(void)
{
    return inp(COM1);
}

int serial_write(const unsigned char *data, unsigned short length)
{
    unsigned short i;
    for (i = 0; i < length; ++i) {
        clock_t deadline = clock() + CLOCKS_PER_SEC;
        while (!(inp(COM1 + 5) & 0x20))
            if (clock() >= deadline) return 0;
        outp(COM1, data[i]);
    }
    return 1;
}

int serial_connected(void)
{
    return (inp(COM1 + 6) & 0x80) != 0;
}

unsigned char serial_line_status(void)
{
    return inp(COM1 + 5);
}

unsigned char serial_modem_status(void)
{
    return inp(COM1 + 6);
}
