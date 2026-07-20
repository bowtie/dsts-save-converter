# DSTS Save Format Research

## Format overview

The PC and Switch save formats are nearly identical at the binary level. The
only differences are:

1. **Container:** PC saves are AES-128-ECB encrypted; Switch saves use a
   plaintext header + LZ4-compressed body.
2. **Outfit struct shift:** The outfit struct (92 bytes at `0x0FDC10`) is
   shifted +4 bytes on Switch. This moves gender, costume, and companion
   values to their correct Switch offsets.
3. **Model data:** The game re-initializes model/appearance data on map
   changes from gender + costume index, so we zero those regions (801 bytes).
   No reference save needed.

## File layout

- `0000.bin`–`0015.bin` — 16 save slots (encrypted on PC, header+LZ4 on Switch)
- `slot_0000.bin`–`slot_0015.bin` — plaintext metadata for each slot (720 bytes)
  - offset `0x00`: slot label (e.g. `#00 Unused text`)
  - offset `0x40`: player name (null-terminated string)
  - offset `0xC0`: play time string (e.g. `Play Time　11Hours20Minutes`)

## Save sizes

| Constant           | Value     | Notes                              |
| ------------------ | --------- | ---------------------------------- |
| `HEADER_SIZE`      | 1024      | Plaintext header on both platforms |
| `BINARY_DATA_SIZE` | 3,097,152 | Uncompressed body                  |
| `PC_SAVE_SIZE`     | 3,098,176 | Header + body (encrypted on PC)    |

## PC saves (AES-128-ECB)

- Encrypted with AES-128-ECB using the fixed key `33393632373736373534353535383833`.
- Always exactly `PC_SAVE_SIZE` bytes.
- No padding — input length must be divisible by the 16-byte block size.
- Header bytes appear as gibberish when encrypted.

## Switch saves (plaintext header + LZ4)

- 1024-byte plaintext header followed by LZ4-compressed body.
- Variable total size (compressed body is variable length).
- Header is readable text, comma-separated fields.
- Field 1 must equal `BINARY_DATA_SIZE` (used for validation).
- Uses raw LZ4 **block** compression (not frame).

## Outfit struct shift

The outfit struct (92 bytes) is at `0x0FDC10` on PC and `0x0FDC14` on Switch.
The +4 shift moves gender, costume, and companion values to their correct
Switch offsets. The gap left by the shift is zeroed.

## Gender byte

- Save-menu gender is at `0x0FDC50` on **both** platforms (`0=male, 1=female`).
- In-game model gender is at `0x0FDC50` on PC, `0x0FDC54` on Switch (shifted +4).
- The shift moves it; we just restore `0x0FDC50` after.

## Model regions (zeroed — game refills on map change)

The game re-initializes these on map changes from gender + costume index.
Verified for both male and female: zeroed regions render correctly, the game
rewrites model data on map change, and the appearance block stays zero
permanently.

| Region                   | Offset     | Size |
| ------------------------ | ---------- | ---- |
| `MODEL_DATA_START`       | `0x0FDD84` | 28   |
| `APPEARANCE_BLOCK_START` | `0x0FDEBD` | 773  |

## LZ4

Switch saves use raw LZ4 **block** compression (not frame).
