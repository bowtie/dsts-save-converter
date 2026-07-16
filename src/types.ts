/** Shared constants and types for the save converter. */

export const HEADER_SIZE = 1024;
export const BINARY_DATA_SIZE = 3_097_152;
export const PC_SAVE_SIZE = 3_098_176;

// ── Trainer model fix ──────────────────────────────────────
// PC stores gender at 0x0FDC50 (0=male, 1=female).
// Switch expects gender at 0x0FDC54 and a zero format flag at 0x0FDC61.
export const PC_GENDER_OFFSET = 0x0fdc50;
export const SWITCH_GENDER_OFFSET = 0x0fdc54;
export const TRAINER_FORMAT_OFFSET = 0x0fdc61;

// ── Agent skill tree state (DO NOT ZERO) ───────────────────
// These bytes track agent skill tree progression (0x00 = locked,
// 0x01 = first skill, 0x2E = 46 skills maxed). Zeroing them would
// wipe skill tree progress. They must be preserved during conversion.
//
// 0x0FDAD0: Main skill tree (not affected by skill unlocks)
// 0x0FDAE8: Skill tree 1
// 0x0FDAEC: Skill tree 2
// 0x0FDAF0: Skill tree 3
// 0x0FDAF4: Skill tree 4

// ── Appearance regions ─────────────────────────────────────
// PC and Switch use fundamentally different encodings for the
// appearance/model block (PC uses string-based costume references
// like "common043", Switch uses binary IDs). These regions must be
// transplanted from a native Switch save (same gender) for costume
// changes to work in-game. PC appearance is readable by Switch (model
// loads) but not writable (costume selection has no effect).
export const APPEARANCE_REGIONS: ReadonlyArray<readonly [number, number]> = [
  [0x0fdad1, 6], // costume ID
  [0x0fdb11, 3], // color/flag 1
  [0x0fdc16, 88], // model data 1
  [0x0fdd84, 28], // model data 2
  [0x0fdebd, 773], // appearance/model block (PC strings → Switch binary IDs)
  [0x105119, 3], // color/flag 2
  [0x1051d8, 8], // color/flag 3
];

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
