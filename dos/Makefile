CC=wcl
CFLAGS=-q -bt=dos -ml -3 -s -os -za -k32768

liza.exe: liza.c link.c files.c commands.c terminal.c xms.c protocol.c serial.c protocol.h proto_gen.h serial.h terminal.h xms.h link.h files.h commands.h themes_gen.h
	$(CC) $(CFLAGS) -fe=liza.exe liza.c link.c files.c commands.c terminal.c xms.c protocol.c serial.c

clean:
	@if exist liza.exe del liza.exe
	@if exist *.obj del *.obj
