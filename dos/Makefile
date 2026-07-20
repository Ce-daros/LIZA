CC=wcl
CFLAGS=-q -bt=dos -ml -3 -s -os -za -k32768

liza.exe: liza.c terminal.c protocol.c serial.c protocol.h proto_gen.h serial.h terminal.h themes_gen.h
	$(CC) $(CFLAGS) -fe=liza.exe liza.c terminal.c protocol.c serial.c

clean:
	@if exist liza.exe del liza.exe
	@if exist *.obj del *.obj
