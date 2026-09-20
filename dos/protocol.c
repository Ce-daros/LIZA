#include <string.h>
#include "protocol.h"

unsigned short liza_encode(unsigned char *output, unsigned char type,
                           unsigned short sequence, const unsigned char *payload,
                           unsigned short length)
{
    output[0] = 0x4c;
    output[1] = 0x5a;
    output[2] = LIZA_VERSION;
    output[3] = type;
    output[4] = sequence & 0xff;
    output[5] = sequence >> 8;
    output[6] = length & 0xff;
    output[7] = length >> 8;
    memcpy(output + 8, payload, length);
    return length + 8;
}

/* After rejecting a candidate frame, resume scanning one byte after its
   sync: the bytes already buffered may themselves contain a new sync pair.
   Keep any such candidate (and the bytes after it) for further decoding. */
static void decoder_resync(liza_decoder *decoder)
{
    unsigned short i;

    for (i = 0; i + 1 < decoder->used; ++i) {
        if (decoder->data[i] == LIZA_SYNC_0 &&
            decoder->data[i + 1] == LIZA_SYNC_1) {
            memmove(decoder->data, decoder->data + i + 2,
                    decoder->used - i - 2);
            decoder->used = (unsigned short)(decoder->used - i - 2);
            decoder->expected = 0;
            decoder->state = 2;
            return;
        }
    }
    /* No full pair; a trailing sync byte stays a partial candidate. */
    decoder->state = (decoder->used != 0 &&
                      decoder->data[decoder->used - 1] == LIZA_SYNC_0) ? 1 : 0;
    decoder->used = 0;
    decoder->expected = 0;
}

int liza_decode_byte(liza_decoder *decoder, unsigned char byte, liza_frame *frame)
{
    unsigned short length;

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
    for (;;) {
        if (decoder->expected == 0) {
            if (decoder->used < 6) return 0;
            length = decoder->data[4] | ((unsigned short)decoder->data[5] << 8);
            if (decoder->data[0] != LIZA_VERSION || length > LIZA_MAX_PAYLOAD) {
                decoder_resync(decoder);
                if (decoder->state != 2) return 0;
                continue;
            }
            decoder->expected = length + 6;
        }
        if (decoder->used < decoder->expected) return 0;
        length = decoder->expected - 6;
        break;
    }

    decoder->state = 0;
    decoder->used = 0;
    decoder->expected = 0;
    frame->length = length;
    frame->type = decoder->data[1];
    frame->sequence = decoder->data[2] |
                      ((unsigned short)decoder->data[3] << 8);
    memcpy(frame->payload, decoder->data + 6, length);
    return 1;
}
