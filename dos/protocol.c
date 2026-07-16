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

static void discard_first(liza_decoder *decoder)
{
    --decoder->used;
    memmove(decoder->data, decoder->data + 1, decoder->used);
}

int liza_decode_byte(liza_decoder *decoder, unsigned char byte, liza_frame *frame)
{
    unsigned short length;
    unsigned short frame_length;
    unsigned short expected;

    if (decoder->used == sizeof(decoder->data)) decoder->used = 0;
    decoder->data[decoder->used++] = byte;

    while (decoder->used >= 2) {
        if (decoder->data[0] != 0x4c || decoder->data[1] != 0x5a) {
            discard_first(decoder);
            continue;
        }
        if (decoder->used < 8) return 0;
        length = decoder->data[6] | ((unsigned short)decoder->data[7] << 8);
        if (decoder->data[2] != LIZA_VERSION || length > LIZA_MAX_PAYLOAD) {
            discard_first(decoder);
            continue;
        }
        frame_length = length + 10;
        if (decoder->used < frame_length) return 0;
        expected = decoder->data[frame_length - 2] |
                   ((unsigned short)decoder->data[frame_length - 1] << 8);
        if (expected != liza_crc16(decoder->data + 2, length + 6)) {
            discard_first(decoder);
            continue;
        }
        frame->type = decoder->data[3];
        frame->sequence = decoder->data[4] |
                          ((unsigned short)decoder->data[5] << 8);
        frame->length = length;
        memcpy(frame->payload, decoder->data + 8, length);
        decoder->used -= frame_length;
        memmove(decoder->data, decoder->data + frame_length, decoder->used);
        return 1;
    }
    return 0;
}

