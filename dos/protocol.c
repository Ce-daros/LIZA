#include <string.h>
#include "protocol.h"

unsigned short liza_crc16(const unsigned char *data, unsigned short length)
{
    unsigned short crc = 0xffff;
    unsigned short i;
    unsigned char bit;
    for (i = 0; i < length; ++i) {
        crc ^= (unsigned short)data[i] << 8;
        for (bit = 0; bit < 8; ++bit)
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
    return crc;
}

unsigned short liza_encode(unsigned char *output, unsigned char type,
                           unsigned short sequence, const unsigned char *payload,
                           unsigned short length)
{
    unsigned short crc;
    output[0] = 0x4c;
    output[1] = 0x5a;
    output[2] = LIZA_VERSION;
    output[3] = type;
    output[4] = sequence & 0xff;
    output[5] = sequence >> 8;
    output[6] = length & 0xff;
    output[7] = length >> 8;
    memcpy(output + 8, payload, length);
    crc = liza_crc16(output + 2, length + 6);
    output[length + 8] = crc & 0xff;
    output[length + 9] = crc >> 8;
    return length + 10;
}

int liza_decode_byte(liza_decoder *decoder, unsigned char byte, liza_frame *frame)
{
    unsigned short length;
    unsigned short expected;

    if (decoder->state == 0) {
        if (byte == LIZA_SYNC_0) decoder->state = 1;
        return 0;
    }
    if (decoder->state == 1) {
        if (byte == LIZA_SYNC_1) {
            decoder->state = 2;
            decoder->used = 0;
            decoder->expected = 0;
        } else if (byte != LIZA_SYNC_0) {
            decoder->state = 0;
        }
        return 0;
    }

    decoder->data[decoder->used++] = byte;
    if (decoder->used == 6) {
        length = decoder->data[4] | ((unsigned short)decoder->data[5] << 8);
        if (decoder->data[0] != LIZA_VERSION || length > LIZA_MAX_PAYLOAD) {
            decoder->state = byte == LIZA_SYNC_0 ? 1 : 0;
            decoder->used = 0;
            return 0;
        }
        decoder->expected = length + 8;
    }
    if (decoder->expected == 0 || decoder->used < decoder->expected) return 0;

    length = decoder->expected - 8;
    expected = decoder->data[decoder->expected - 2] |
               ((unsigned short)decoder->data[decoder->expected - 1] << 8);
    decoder->state = 0;
    decoder->used = 0;
    decoder->expected = 0;
    if (expected != liza_crc16(decoder->data, length + 6)) return 0;

    frame->type = decoder->data[1];
    frame->sequence = decoder->data[2] |
                      ((unsigned short)decoder->data[3] << 8);
    frame->length = length;
    memcpy(frame->payload, decoder->data + 6, length);
    return 1;
}
