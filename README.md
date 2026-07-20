# DSTS Save Converter

A save converter for Digimon Story: Time Stranger. Converts PC saves to Nintendo Switch format. Everything runs in the browser, no files leave your device.

## Usage

Drop your PC save folder into the converter and it figures out the rest. Select the saves you want to convert, hit Convert, and download the ZIP.

## How it works

The PC and Switch save formats are nearly identical at the binary level. The converter handles three differences:

1. **Container** — PC saves are AES-128-ECB encrypted; Switch saves use a plaintext header + LZ4-compressed body.
2. **Outfit struct shift** — The outfit struct (92 bytes at 0x0FDC10) is shifted +4 bytes on Switch. The converter shifts gender, costume, and companion values to their correct Switch offsets.
3. **Model data** — The game initializes model/appearance data at runtime from gender + costume index, so the converter zeros those regions (801 bytes). No reference save needed.

Everything else — roster, inventory, items, quests, dialogue, playtime, position, Digimon data, agent skill trees — passes through byte-for-byte from the PC save.

## Notes

- This is experimental. The full extent of what carries over properly between PC and Switch isn't known yet, so back up your save before using it.
- Only PC to Switch is supported for now. Switch to PC is coming later.
