/** Shared constants and types for the save converter. */

export const HEADER_SIZE = 1024;
export const BINARY_DATA_SIZE = 3_097_152;
export const PC_SAVE_SIZE = 3_098_176;

// ── Outfit struct (shifted +4 on Switch) ───────────────────
// The outfit struct (92 bytes) is at 0x0FDC10 on PC and 0x0FDC14 on Switch.
// The +4 shift moves gender, costume, and companion values to their
// correct Switch offsets. The game initializes model data at runtime,
// so we zero those regions — no reference save needed.
export const OUTFIT_STRUCT_START = 0x0fdc10;
export const OUTFIT_STRUCT_SIZE = 0x5c; // 92 bytes

// ── Gender ─────────────────────────────────────────────────
// Save-menu gender is at 0x0FDC50 on BOTH platforms (0=male, 1=female).
// In-game model gender is at 0x0FDC50 on PC, 0x0FDC54 on Switch (shifted +4).
// The shift moves it; we just restore 0x0FDC50 after.
export const GENDER_OFFSET = 0x0fdc50;

// ── Model regions (zeroed — game fills at runtime) ─────────
export const MODEL_DATA_START = 0x0fdd84;
export const MODEL_DATA_SIZE = 28;
export const APPEARANCE_BLOCK_START = 0x0fdebd;
export const APPEARANCE_BLOCK_SIZE = 773;

// ── Binary helpers ─────────────────────────────────────────

/** Extract the text portion of a 1024-byte save header. */
export function parseHeaderText(headerBytes: Uint8Array): string {
  let nullPos = headerBytes.length;
  for (let i = 0; i < headerBytes.length; i++) {
    if (headerBytes[i] === 0) {
      nullPos = i;
      break;
    }
  }
  return new TextDecoder("ascii").decode(headerBytes.subarray(0, nullPos));
}

/** Decode a base64 string into a Uint8Array. */
export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
