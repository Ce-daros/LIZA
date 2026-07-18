#ifndef LIZA_SERIAL_H
#define LIZA_SERIAL_H

int serial_open(void);
int serial_can_read(void);
unsigned char serial_read(void);
int serial_write(const unsigned char *data, unsigned short length);

#endif
