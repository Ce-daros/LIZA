#ifndef LIZA_XMS_H
#define LIZA_XMS_H

int xms_initialize(void);
int xms_allocate(unsigned short kilobytes, unsigned short *handle);
int xms_free(unsigned short handle);
int xms_read(unsigned short handle, unsigned long source_offset,
             void __far *destination, unsigned long length);
int xms_write(unsigned short handle, unsigned long destination_offset,
              const void __far *source, unsigned long length);

#endif
