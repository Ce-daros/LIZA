CC=wcl
CFLAGS=-q -bt=dos -ml -3 -s -os -za -k32768

liza.exe: liza.c protocol.c serial.c protocol.h serial.h
	$(CC) $(CFLAGS) -fe=liza.exe liza.c protocol.c serial.c

clean:
	@if exist liza.exe del liza.exe
	@if exist *.obj del *.obj
