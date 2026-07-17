#ifndef LIZA_PROTOCOL_H
#define LIZA_PROTOCOL_H

#include "proto_gen.h"

typedef struct {
    unsigned char type;
    unsigned short sequence;
    unsigned short length;
    unsigned char payload[LIZA_MAX_PAYLOAD];
} liza_frame;

typedef struct {
    unsigned char data[LIZA_MAX_PAYLOAD + 8];
    unsigned short used;
    unsigned short expected;
    unsigned char state;
} liza_decoder;

unsigned short liza_crc16(const unsigned char *data, unsigned short length);
unsigned short liza_encode(unsigned char *output, unsigned char type,
                           unsigned short sequence, const unsigned char *payload,
                           unsigned short length);
int liza_decode_byte(liza_decoder *decoder, unsigned char byte, liza_frame *frame);

#endif
