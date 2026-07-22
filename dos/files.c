#include <dos.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include "files.h"
#include "link.h"

static FILE *active_write_file;
static unsigned short active_write_sequence;
static unsigned short active_write_status;
static unsigned long active_write_bytes;

static unsigned long read_u32(const unsigned char *data)
{
    return (unsigned long)data[0] |
           ((unsigned long)data[1] << 8) |
           ((unsigned long)data[2] << 16) |
           ((unsigned long)data[3] << 24);
}

static void write_u16(unsigned char *data, unsigned short value)
{
    data[0] = value & 0xff;
    data[1] = value >> 8;
}

static void write_u32(unsigned char *data, unsigned long value)
{
    data[0] = value & 0xff;
    data[1] = (value >> 8) & 0xff;
    data[2] = (value >> 16) & 0xff;
    data[3] = (value >> 24) & 0xff;
}

static void copy_path(char *target, const unsigned char *source,
                      unsigned short length)
{
    memcpy(target, source, length);
    target[length] = '\0';
}

int files_handle_read(const liza_frame *request)
{
    char path[LIZA_MAX_PATH_BYTES + 1];
    FILE *file;
    unsigned char buffer[LIZA_FILE_CHUNK_BYTES];
    unsigned char ending[7];
    unsigned long offset;
    unsigned long position;
    unsigned long end;
    unsigned short maximum;
    unsigned short count;
    unsigned short wanted;
    unsigned short status = 0;

    if (request->length < 7 || request->length > 6 + LIZA_MAX_PATH_BYTES) return 0;
    offset = read_u32(request->payload);
    maximum = request->payload[4] | ((unsigned short)request->payload[5] << 8);
    copy_path(path, request->payload + 6, request->length - 6);
    link_own_status_start("READ", path);
    file = fopen(path, "rb");
    if (file == NULL) {
        status = errno;
        position = offset;
        end = offset;
    } else if (fseek(file, (long)offset, SEEK_SET) != 0) {
        status = errno;
        position = offset;
        end = offset;
        fclose(file);
        file = NULL;
    } else {
        while (maximum != 0) {
            wanted = maximum > sizeof(buffer) ? sizeof(buffer) : maximum;
            count = (unsigned short)fread(buffer, 1, wanted, file);
            if (count != 0 && !link_send_at(LIZA_READ_FILE_CHUNK, request->sequence,
                                            buffer, count)) {
                fclose(file);
                return 0;
            }
            maximum -= count;
            if (count < wanted) break;
        }
        position = (unsigned long)ftell(file);
        fseek(file, 0, SEEK_END);
        end = (unsigned long)ftell(file);
        fclose(file);
    }
    write_u16(ending, status);
    write_u32(ending + 2, position);
    ending[6] = position >= end;
    link_own_status_finish(status == 0);
    return link_send_at(LIZA_READ_FILE_END, request->sequence, ending,
                        sizeof(ending));
}

int files_handle_write_start(const liza_frame *request)
{
    char path[LIZA_MAX_PATH_BYTES + 1];
    const char *mode;

    if (request->length < 2 || request->length > LIZA_MAX_PATH_BYTES + 1) return 0;
    if (active_write_file != NULL) fclose(active_write_file);
    active_write_file = NULL;
    active_write_sequence = request->sequence;
    active_write_status = 0;
    active_write_bytes = 0;
    copy_path(path, request->payload + 1, request->length - 1);
    if (request->payload[0] == 1) mode = "wb";
    else if (request->payload[0] == 2) mode = "ab";
    else return 0;
    link_own_status_start("WRITE", path);
    active_write_file = fopen(path, mode);
    if (active_write_file == NULL) active_write_status = errno;
    return 1;
}

int files_handle_write_chunk(const liza_frame *request)
{
    unsigned short count;
    if (request->sequence != active_write_sequence) return 0;
    if (active_write_status != 0) return 1;
    if (active_write_file == NULL) return 0;
    count = (unsigned short)fwrite(request->payload, 1, request->length,
                                   active_write_file);
    active_write_bytes += count;
    if (count != request->length) active_write_status = errno;
    return 1;
}

int files_handle_write_end(const liza_frame *request)
{
    unsigned char result[6];
    if (request->sequence != active_write_sequence) return 0;
    if (active_write_file != NULL) {
        if (fclose(active_write_file) != 0 && active_write_status == 0)
            active_write_status = errno;
        active_write_file = NULL;
    }
    write_u16(result, active_write_status);
    write_u32(result + 2, active_write_bytes);
    link_own_status_finish(active_write_status == 0);
    return link_send_at(LIZA_WRITE_FILE_RESULT, request->sequence, result,
                        sizeof(result));
}

int files_handle_list(const liza_frame *request)
{
    char directory[LIZA_MAX_PATH_BYTES + 1];
    char pattern[LIZA_MAX_PATH_BYTES + 1];
    char specification[2 * LIZA_MAX_PATH_BYTES + 4];
    char line[96];
    struct find_t found;
    unsigned char ending[5];
    unsigned short cursor;
    unsigned short skipped = 0;
    unsigned short emitted = 0;
    unsigned short status;
    unsigned short result_status = 0;
    unsigned short next;
    unsigned char limit;
    unsigned char directory_length;
    int eof = 0;
    int search_open = 0;
    int length;
    unsigned year, month, day, hour, minute, second;

    if (request->length < 6) return 0;
    cursor = request->payload[0] | ((unsigned short)request->payload[1] << 8);
    limit = request->payload[2];
    directory_length = request->payload[3];
    if (limit == 0 || limit > 50 || directory_length == 0 ||
        4 + directory_length >= request->length || directory_length > LIZA_MAX_PATH_BYTES ||
        request->length - 4 - directory_length > LIZA_MAX_PATH_BYTES) return 0;
    copy_path(directory, request->payload + 4, directory_length);
    copy_path(pattern, request->payload + 4 + directory_length,
              request->length - 4 - directory_length);
    strcpy(specification, directory);
    length = strlen(specification);
    if (length != 0 && specification[length - 1] != '\\' &&
        specification[length - 1] != '/') strcat(specification, "\\");
    strcat(specification, pattern);
    link_own_status_start("FILES", specification);

    status = _dos_findfirst(specification,
                            _A_RDONLY | _A_HIDDEN | _A_SYSTEM |
                            _A_SUBDIR | _A_ARCH, &found);
    if (status == 0) search_open = 1;
    else if (status != 2 && status != 18) result_status = status;
    while (status == 0 && skipped < cursor) {
        ++skipped;
        status = _dos_findnext(&found);
    }
    while (status == 0 && emitted < limit) {
        year = 1980 + (found.wr_date >> 9);
        month = (found.wr_date >> 5) & 15;
        day = found.wr_date & 31;
        hour = found.wr_time >> 11;
        minute = (found.wr_time >> 5) & 63;
        second = (found.wr_time & 31) * 2;
        length = sprintf(line, "%s\t%lu\t%02X\t%04u-%02u-%02u\t%02u:%02u:%02u\r\n",
                         found.name, found.size, (unsigned char)found.attrib,
                         year, month, day, hour, minute, second);
        if (!link_send_at(LIZA_LIST_FILES_CHUNK, request->sequence,
                          (const unsigned char *)line, length)) {
            if (search_open) _dos_findclose(&found);
            return 0;
        }
        ++emitted;
        status = _dos_findnext(&found);
    }
    if (search_open && status != 0 && status != 18)
        result_status = status;
    eof = status != 0;
    if (search_open) _dos_findclose(&found);
    next = cursor + emitted;
    write_u16(ending, result_status);
    write_u16(ending + 2, next);
    ending[4] = eof;
    link_own_status_finish(result_status == 0);
    return link_send_at(LIZA_LIST_FILES_END, request->sequence, ending,
                        sizeof(ending));
}

void files_abort_write(void)
{
    if (active_write_file != NULL) {
        fclose(active_write_file);
        active_write_file = NULL;
    }
}
