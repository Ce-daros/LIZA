#ifndef LIZA_PROTOCOL_H
#define LIZA_PROTOCOL_H

#define LIZA_VERSION 1
#define LIZA_MAX_PAYLOAD 1024

#define LIZA_HELLO 1
#define LIZA_HELLO_ACK 2
#define LIZA_TEXT 3
#define LIZA_ERROR 4
#define LIZA_DISCONNECT 5
#define LIZA_SESSION_START 6
#define LIZA_PROMPT_CHUNK 7
#define LIZA_PROMPT_END 8
#define LIZA_ASSISTANT_CHUNK 9
#define LIZA_EXEC_REQUEST 10
#define LIZA_EXEC_RESULT_CHUNK 11
#define LIZA_EXEC_RESULT_END 12
#define LIZA_COMPLETE 13
#define LIZA_CANCEL 14
#define LIZA_NEW_SESSION 15
#define LIZA_SESSION_READY 16
#define LIZA_PING 17
#define LIZA_PONG 18
#define LIZA_READ_FILE_REQUEST 19
#define LIZA_READ_FILE_CHUNK 20
#define LIZA_READ_FILE_END 21
#define LIZA_WRITE_FILE_START 22
#define LIZA_WRITE_FILE_CHUNK 23
#define LIZA_WRITE_FILE_END 24
#define LIZA_WRITE_FILE_RESULT 25
#define LIZA_LIST_FILES_REQUEST 26
#define LIZA_LIST_FILES_CHUNK 27
#define LIZA_LIST_FILES_END 28
#define LIZA_STYLED_ASSISTANT_CHUNK 29

#define LIZA_MODE_ONE_SHOT 1
#define LIZA_MODE_INTERACTIVE 2

typedef struct {
    unsigned char type;
    unsigned short sequence;
    unsigned short length;
    unsigned char payload[LIZA_MAX_PAYLOAD];
} liza_frame;

typedef struct {
    unsigned char data[LIZA_MAX_PAYLOAD + 10];
    unsigned short used;
} liza_decoder;

unsigned short liza_crc16(const unsigned char *data, unsigned short length);
unsigned short liza_encode(unsigned char *output, unsigned char type,
                           unsigned short sequence, const unsigned char *payload,
                           unsigned short length);
int liza_decode_byte(liza_decoder *decoder, unsigned char byte, liza_frame *frame);

#endif
