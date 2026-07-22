#ifndef LIZA_FILES_H
#define LIZA_FILES_H

#include "protocol.h"

int files_handle_read(const liza_frame *request);
int files_handle_write_start(const liza_frame *request);
int files_handle_write_chunk(const liza_frame *request);
int files_handle_write_end(const liza_frame *request);
int files_handle_list(const liza_frame *request);
void files_abort_write(void);

#endif
