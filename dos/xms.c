#include <dos.h>
#include <i86.h>
#include "xms.h"

struct xms_move_request {
    unsigned long length;
    unsigned short source_handle;
    unsigned long source_offset;
    unsigned short destination_handle;
    unsigned long destination_offset;
};
typedef char xms_move_request_must_be_16_bytes[
    sizeof(struct xms_move_request) == 16 ? 1 : -1];

static void (__far *xms_control)(void);
static struct xms_move_request move_request;

static unsigned long xms_physical_address(const void __far *pointer)
{
    return ((unsigned long)FP_SEG(pointer) << 4) + FP_OFF(pointer);
}

static unsigned short xms_call_allocate(unsigned short kilobytes,
                                        unsigned short *handle)
{
    unsigned short result;
    unsigned short allocated_handle;

    __asm {
        mov ah, 09h
        mov dx, kilobytes
        call dword ptr xms_control
        mov result, ax
        mov allocated_handle, dx
    }
    *handle = allocated_handle;
    return result;
}

static unsigned short xms_call_free(unsigned short handle)
{
    unsigned short result;

    __asm {
        mov ah, 0ah
        mov dx, handle
        call dword ptr xms_control
        mov result, ax
    }
    return result;
}

static unsigned short xms_call_move(void)
{
    unsigned short result;

    __asm {
        mov ah, 0bh
        mov si, OFFSET move_request
        call dword ptr xms_control
        mov result, ax
    }
    return result;
}

int xms_initialize(void)
{
    union REGS input;
    union REGS output;
    struct SREGS segments;

    input.x.ax = 0x4300;
    int86(0x2f, &input, &output);
    if (output.h.al != 0x80) return 0;
    input.x.ax = 0x4310;
    int86x(0x2f, &input, &output, &segments);
    xms_control = (void (__far *)(void))MK_FP(segments.es, output.x.bx);
    return 1;
}

int xms_allocate(unsigned short kilobytes, unsigned short *handle)
{
    return xms_control != 0 && xms_call_allocate(kilobytes, handle) == 1;
}

int xms_free(unsigned short handle)
{
    return xms_control != 0 && xms_call_free(handle) == 1;
}

static int xms_move(unsigned short source_handle, unsigned long source_offset,
                    unsigned short destination_handle, unsigned long destination_offset,
                    unsigned long length)
{
    if (xms_control == 0) return 0;
    move_request.length = length;
    move_request.source_handle = source_handle;
    move_request.source_offset = source_offset;
    move_request.destination_handle = destination_handle;
    move_request.destination_offset = destination_offset;
    return xms_call_move() == 1;
}

int xms_read(unsigned short handle, unsigned long source_offset,
             void __far *destination, unsigned long length)
{
    return xms_move(handle, source_offset, 0,
                    xms_physical_address(destination), length);
}

int xms_write(unsigned short handle, unsigned long destination_offset,
              const void __far *source, unsigned long length)
{
    return xms_move(0, xms_physical_address(source), handle, destination_offset,
                    length);
}
