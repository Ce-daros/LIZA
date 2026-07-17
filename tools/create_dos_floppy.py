from pathlib import Path
import struct

SECTOR = 512
TOTAL = 2880
FAT_SECTORS = 9
ROOT_ENTRIES = 224
ROOT_SECTORS = ROOT_ENTRIES * 32 // SECTOR
DATA_START = 1 + FAT_SECTORS * 2 + ROOT_SECTORS

def short_name(name: str) -> bytes:
    stem, suffix = name.upper().split(".", 1)
    return f"{stem:<8}{suffix:<3}".encode("ascii")

def fat12_set(fat: bytearray, cluster: int, value: int) -> None:
    offset = cluster + cluster // 2
    if cluster & 1:
        fat[offset] = (fat[offset] & 0x0F) | ((value << 4) & 0xF0)
        fat[offset + 1] = (value >> 4) & 0xFF
    else:
        fat[offset] = value & 0xFF
        fat[offset + 1] = (fat[offset + 1] & 0xF0) | ((value >> 8) & 0x0F)

def make_image(output: Path, files: list[tuple[str, bytes]]) -> None:
    image = bytearray(SECTOR * TOTAL)
    boot = bytearray(SECTOR)
    boot[0:3] = b"\xEB\x3C\x90"
    boot[3:11] = b"LIZA    "
    struct.pack_into("<H", boot, 11, SECTOR)
    boot[13] = 1
    struct.pack_into("<H", boot, 14, 1)
    boot[16] = 2
    struct.pack_into("<H", boot, 17, ROOT_ENTRIES)
    struct.pack_into("<H", boot, 19, TOTAL)
    boot[21] = 0xF0
    struct.pack_into("<H", boot, 22, FAT_SECTORS)
    struct.pack_into("<H", boot, 24, 18)
    struct.pack_into("<H", boot, 26, 2)
    boot[38] = 0x29
    struct.pack_into("<I", boot, 39, 0x4C495A41)
    boot[43:54] = b"LIZA DOS   "
    boot[54:62] = b"FAT12   "
    chain_hard_disk = bytes([
        0xFA,
        0x31, 0xC0,
        0x8E, 0xD8,
        0x8E, 0xC0,
        0x8E, 0xD0,
        0xBC, 0x00, 0x7C,
        0xFB,
        0xBB, 0x00, 0x7C,
        0xB2, 0x80,
        0xB4, 0x02,
        0xB0, 0x01,
        0xB5, 0x00,
        0xB1, 0x01,
        0xB6, 0x00,
        0xCD, 0x13,
        0x72, 0x05,
        0xEA, 0x00, 0x7C, 0x00, 0x00,
        0xCD, 0x18,
        0xEB, 0xFE,
    ])
    boot[62:62 + len(chain_hard_disk)] = chain_hard_disk
    boot[510:512] = b"\x55\xAA"
    image[:SECTOR] = boot

    fat = bytearray(FAT_SECTORS * SECTOR)
    fat[0:3] = b"\xF0\xFF\xFF"
    next_cluster = 2
    entries = []
    for name, content in files:
        clusters = max(1, (len(content) + SECTOR - 1) // SECTOR)
        first = next_cluster
        for cluster in range(first, first + clusters - 1):
            fat12_set(fat, cluster, cluster + 1)
        fat12_set(fat, first + clusters - 1, 0xFFF)
        for index in range(clusters):
            cluster = first + index
            start = (DATA_START + cluster - 2) * SECTOR
            image[start:start + len(content[index * SECTOR:(index + 1) * SECTOR])] = content[index * SECTOR:(index + 1) * SECTOR]
        entries.append((name, len(content), first))
        next_cluster += clusters

    fat_start = SECTOR
    image[fat_start:fat_start + len(fat)] = fat
    image[fat_start + FAT_SECTORS * SECTOR:fat_start + FAT_SECTORS * SECTOR + len(fat)] = fat
    root_start = (1 + FAT_SECTORS * 2) * SECTOR
    for index, (name, size, first) in enumerate(entries):
        entry = bytearray(32)
        entry[0:11] = short_name(name)
        entry[11] = 0x20
        struct.pack_into("<H", entry, 26, first)
        struct.pack_into("<I", entry, 28, size)
        image[root_start + index * 32:root_start + (index + 1) * 32] = entry
    output.write_bytes(image)

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    output = root / "dos" / "LIZA-DOS.img"
    files = [
        ("LIZA.EXE", (root / "dos" / "liza.exe").read_bytes()),
        ("XGREP.COM", (root / "dos" / "tools" / "XGREP.COM").read_bytes()),
        ("SED.EXE", (root / "dos" / "tools" / "SED.EXE").read_bytes()),
        ("TEE.EXE", (root / "dos" / "tools" / "TEE.EXE").read_bytes()),
        ("CWSDPMI.EXE", (root / "dos" / "tools" / "CWSDPMI.EXE").read_bytes()),
    ]
    make_image(output, files)
