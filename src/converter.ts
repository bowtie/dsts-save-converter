/**
 * Core conversion logic: PC → Switch save format.
 *
 * The PC and Switch save formats are nearly identical at the binary level.
 * The only differences are:
 *
 * 1. Container: PC saves are AES-128-ECB encrypted; Switch saves use
 *    a plaintext header + LZ4-compressed body.
 *
 * 2. Trainer model flags (2 bytes):
 *    - PC stores gender at 0x0FDC50 (0=male, 1=female)
 *    - Switch expects gender at 0x0FDC54 and a zero format flag at 0x0FDC61
 *
 * 3. Appearance data (909 bytes across 7 regions): PC uses string-based
 *    costume references (e.g. "common043"); Switch uses binary IDs.
 *    PC appearance is readable by Switch (model loads) but not writable
 *    (costume selection has no effect). These regions must be transplanted
 *    from a native Switch save of the same gender.
 *
 * Everything else — roster, inventory, items, quests, dialogue, playtime,
 * position, Digimon data, agent skill trees — passes through byte-for-byte
 * from the PC save.
 */
import { lz4Decompress, lz4Compress } from "./lz4";
import { decryptPc } from "./crypto";
import {
  HEADER_SIZE,
  BINARY_DATA_SIZE,
  PC_SAVE_SIZE,
  PC_GENDER_OFFSET,
  SWITCH_GENDER_OFFSET,
  TRAINER_FORMAT_OFFSET,
  APPEARANCE_REGIONS,
  parseHeaderText,
  base64ToUint8Array,
} from "./types";

export interface ConversionResult {
  files: Map<string, Uint8Array>;
  log: string;
}

// ── Switch references (embedded, gender-specific) ──────────
//
// We embed two Switch reference saves — one male, one female — from the
// same game point. The appearance regions are gender-specific, so we must
// transplant from the reference that matches the PC save's gender.

let _swRefMaleBinary: Uint8Array | null = null;
let _swRefFemaleBinary: Uint8Array | null = null;
let _swRefMaleB64: string | null = null;
let _swRefFemaleB64: string | null = null;

/** Load both Switch reference base64 strings (fetched once from public/). */
export async function loadSwitchRefB64(): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (!_swRefMaleB64) {
    tasks.push(
      fetch("./switch_ref_male.b64")
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load male Switch reference: HTTP ${r.status}`);
          return r.text();
        })
        .then((t) => {
          _swRefMaleB64 = t;
        }),
    );
  }
  if (!_swRefFemaleB64) {
    tasks.push(
      fetch("./switch_ref_female.b64")
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load female Switch reference: HTTP ${r.status}`);
          return r.text();
        })
        .then((t) => {
          _swRefFemaleB64 = t;
        }),
    );
  }
  await Promise.all(tasks);
}

/**
 * Parse and validate a Switch save header.
 * Requires exactly HEADER_SIZE bytes, field 1 must equal BINARY_DATA_SIZE.
 */
function parseSwitchHeader(headerBytes: Uint8Array, source: string): void {
  if (headerBytes.length !== HEADER_SIZE) {
    throw new Error(
      `Invalid Switch header from ${source}: expected ${HEADER_SIZE} bytes, got ${headerBytes.length}`,
    );
  }
  const headerText = parseHeaderText(headerBytes);
  const fields = headerText.split(",");
  if (fields.length < 2) {
    throw new Error(`Invalid Switch header from ${source}: not enough fields`);
  }
  const sizeField = fields[1].trim();
  const parsed = Number.parseInt(sizeField, 10);
  if (!Number.isInteger(parsed) || parsed !== BINARY_DATA_SIZE) {
    throw new Error(
      `Invalid Switch header from ${source}: binary size ${sizeField} does not match expected ${BINARY_DATA_SIZE}`,
    );
  }
}

/** Decompress a Switch reference from its base64 string. */
function decompressRef(b64: string, label: string): Uint8Array {
  const compressed = base64ToUint8Array(b64.trim());
  if (compressed.length <= HEADER_SIZE) {
    throw new Error(`Embedded ${label} is too short`);
  }
  parseSwitchHeader(compressed.subarray(0, HEADER_SIZE), `embedded ${label}`);
  return lz4Decompress(compressed.subarray(HEADER_SIZE), BINARY_DATA_SIZE);
}

/** Get the male Switch reference binary (cached). */
function getSwitchRefMaleBinary(): Uint8Array {
  if (_swRefMaleBinary) return _swRefMaleBinary;
  if (!_swRefMaleB64)
    throw new Error("Male Switch reference not loaded — call loadSwitchRefB64() first");
  _swRefMaleBinary = decompressRef(_swRefMaleB64, "male Switch reference");
  return _swRefMaleBinary;
}

/** Get the female Switch reference binary (cached). */
function getSwitchRefFemaleBinary(): Uint8Array {
  if (_swRefFemaleBinary) return _swRefFemaleBinary;
  if (!_swRefFemaleB64)
    throw new Error("Female Switch reference not loaded — call loadSwitchRefB64() first");
  _swRefFemaleBinary = decompressRef(_swRefFemaleB64, "female Switch reference");
  return _swRefFemaleBinary;
}

// ── Patching ───────────────────────────────────────────────

/**
 * Patch the 2-byte trainer model fix:
 * - Set Switch gender flag (0x0FDC54) to the PC gender value (0 or 1)
 * - Zero the trainer format flag (0x0FDC61)
 *
 * Returns true if the PC save is female.
 */
function patchTrainerModel(body: Uint8Array): boolean {
  const gender = body[PC_GENDER_OFFSET];
  if (gender !== 0 && gender !== 1) {
    throw new Error(
      `Unrecognized PC gender value ${gender} at 0x${PC_GENDER_OFFSET.toString(16).toUpperCase()}`,
    );
  }
  body[SWITCH_GENDER_OFFSET] = gender;
  body[TRAINER_FORMAT_OFFSET] = 0;
  return gender === 1;
}

/**
 * Transplant appearance regions from a native Switch save.
 * PC and Switch use fundamentally different encodings for the
 * appearance/model block. Without this transplant, the model loads
 * but costume changes have no visual effect.
 */
function transplantAppearance(body: Uint8Array, swRefBody: Uint8Array): void {
  for (const [start, length] of APPEARANCE_REGIONS) {
    const end = start + length;
    if (end <= body.length && end <= swRefBody.length) {
      for (let i = 0; i < length; i++) {
        body[start + i] = swRefBody[start + i];
      }
    }
  }
}

// ── Auto-detection ─────────────────────────────────────────

export type Platform = "pc" | "switch" | "unknown";

/**
 * Detect whether save files are PC or Switch format.
 *
 * PC saves: exactly 3,098,176 bytes, AES-128-ECB encrypted (header is gibberish)
 * Switch saves: 1024-byte plaintext header + LZ4-compressed data (variable size, header is readable text)
 */
export async function detectPlatform(files: File[]): Promise<Platform> {
  const saveFiles = files.filter(
    (f) =>
      f.name.endsWith(".bin") &&
      !f.name.startsWith("slot_") &&
      f.name !== "system_data.bin" &&
      f.name !== "sysdata_dx11.bin",
  );
  if (saveFiles.length === 0) return "unknown";

  // PC saves are always exactly 3,098,176 bytes
  const pcCount = saveFiles.filter((f) => f.size === PC_SAVE_SIZE).length;
  if (pcCount === saveFiles.length) return "pc";
  if (pcCount > 0) return "unknown";

  // Non-PC candidates: validate Switch headers
  for (const file of saveFiles) {
    if (file.size <= HEADER_SIZE) return "unknown";
    try {
      const headerBytes = await readFile(file, HEADER_SIZE);
      parseSwitchHeader(headerBytes, file.name);
    } catch {
      return "unknown";
    }
  }
  return "switch";
}

// ── File info extraction ───────────────────────────────────

export interface SaveFileMeta {
  filename: string;
  playerName: string;
  playtime: string;
}

/**
 * Extract player name and playtime from slot_ metadata files.
 * These are plaintext on both PC and Switch (720 bytes each):
 *   offset 0x00: slot label (e.g. "#00 Unused text")
 *   offset 0x40: player name (null-terminated string)
 *   offset 0xC0: play time string (e.g. "Play Time　11Hours20Minutes")
 *
 * Maps slot_NNNN.bin metadata to the corresponding NNNN.bin save file.
 */
export async function extractSaveMeta(files: File[]): Promise<SaveFileMeta[]> {
  const slotFiles = files.filter((f) => f.name.startsWith("slot_") && f.name.endsWith(".bin"));

  const results: SaveFileMeta[] = [];

  for (const file of slotFiles) {
    const data = await readFile(file, 0x100); // only need first 256 bytes

    // Extract player name at offset 0x40 (null-terminated)
    const nameBytes = data.subarray(0x40, 0xc0);
    const nameNull = nameBytes.indexOf(0);
    const playerName =
      new TextDecoder("ascii")
        .decode(nameBytes.subarray(0, nameNull === -1 ? nameBytes.length : nameNull))
        .trim() || "?";

    // Extract play time at offset 0xC0 (null-terminated, contains "Play Time　XHoursYMinutes")
    const timeBytes = data.subarray(0xc0, 0x100);
    const timeNull = timeBytes.indexOf(0);
    const timeStr = new TextDecoder("utf-8")
      .decode(timeBytes.subarray(0, timeNull === -1 ? timeBytes.length : timeNull))
      .trim();

    // Parse "Play Time　11Hours20Minutes" → "11h 20m"
    let playtime = "?";
    const hoursMatch = timeStr.match(/(\d+)H/);
    const minsMatch = timeStr.match(/(\d+)M/);
    if (hoursMatch || minsMatch) {
      const h = hoursMatch ? parseInt(hoursMatch[1]) : 0;
      const m = minsMatch ? parseInt(minsMatch[1]) : 0;
      playtime = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    // Map slot_NNNN.bin → NNNN.bin
    const saveName = file.name.replace("slot_", "");

    results.push({ filename: saveName, playerName, playtime });
  }

  return results;
}

// ── File helpers ───────────────────────────────────────────

async function readFile(file: File, maxBytes?: number): Promise<Uint8Array> {
  const blob = maxBytes ? file.slice(0, maxBytes) : file;
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function parseFileInfo(headerBytes: Uint8Array): {
  playerName: string;
  playtime: string;
} {
  const text = parseHeaderText(headerBytes);
  const fields = text.split(",");
  const playerName = fields[4]?.trim() ?? "?";
  const playtimeRaw = parseFloat(fields[5]?.trim() ?? "0");
  // playtime is in seconds — format as Hh Mm
  const hours = Math.floor(playtimeRaw / 3600);
  const minutes = Math.floor((playtimeRaw % 3600) / 60);
  const playtime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return { playerName, playtime };
}

// ── PC → Switch ────────────────────────────────────────────

/**
 * Convert PC saves to Switch format.
 *
 * Steps per save file:
 * 1. AES-128-ECB decrypt
 * 2. Patch 2-byte trainer model fix (gender + format flag)
 * 3. Zero 5 PC format flags
 * 4. Transplant 7 appearance regions from Switch reference (same gender)
 * 5. LZ4 compress
 *
 * @param pcFiles  All .bin files from the PC save folder
 * @returns Conversion result with output files and log
 */
export async function convertPcToSwitch(pcFiles: File[]): Promise<ConversionResult> {
  await loadSwitchRefB64();
  const swRefMaleBinary = getSwitchRefMaleBinary();
  const swRefFemaleBinary = getSwitchRefFemaleBinary();

  const log: string[] = [];
  const files = new Map<string, Uint8Array>();

  log.push(
    `Loaded Switch references (male: ${swRefMaleBinary.length} bytes, female: ${swRefFemaleBinary.length} bytes)`,
  );

  // Categorize PC files
  const saveFiles = pcFiles.filter(
    (f) =>
      f.name.endsWith(".bin") &&
      !f.name.startsWith("slot_") &&
      f.name !== "system_data.bin" &&
      f.name !== "sysdata_dx11.bin",
  );
  const slotFiles = pcFiles.filter((f) => f.name.startsWith("slot_"));

  if (saveFiles.length === 0) throw new Error("No save .bin files found in PC files.");

  for (const file of saveFiles) {
    const encrypted = await readFile(file);
    if (encrypted.length !== PC_SAVE_SIZE) {
      log.push(`SKIP ${file.name}: wrong size ${encrypted.length}`);
      continue;
    }

    // Decrypt
    const decrypted = decryptPc(encrypted);
    if (decrypted.length !== PC_SAVE_SIZE) {
      throw new Error(
        `${file.name}: decrypted length ${decrypted.length} does not match PC_SAVE_SIZE ${PC_SAVE_SIZE}`,
      );
    }

    // Split header and binary
    const header = decrypted.subarray(0, HEADER_SIZE);
    const binaryData = decrypted.subarray(HEADER_SIZE);
    if (binaryData.length !== BINARY_DATA_SIZE) {
      throw new Error(
        `${file.name}: binary length ${binaryData.length} does not match BINARY_DATA_SIZE ${BINARY_DATA_SIZE}`,
      );
    }

    // Make a mutable copy of the binary
    const body = new Uint8Array(binaryData.length);
    body.set(binaryData);

    // Patch trainer model (2 bytes) — returns gender
    const isFemale = patchTrainerModel(body);

    // Transplant appearance regions from matching Switch reference (909 bytes)
    const swRefBinary = isFemale ? swRefFemaleBinary : swRefMaleBinary;
    transplantAppearance(body, swRefBinary);

    // LZ4 compress
    const compressed = lz4Compress(body);

    // Combine header + compressed
    const output = new Uint8Array(HEADER_SIZE + compressed.length);
    output.set(header, 0);
    output.set(compressed, HEADER_SIZE);
    files.set(file.name, output);

    const info = parseFileInfo(header);
    log.push(
      `${file.name}: -> ${output.length} bytes (player: ${info.playerName}, playtime: ${info.playtime}, ${isFemale ? "female" : "male"}) [converted]`,
    );
  }

  // Copy slot files (plaintext, same format)
  for (const file of slotFiles) {
    const data = await readFile(file);
    files.set(file.name, data);
    log.push(`${file.name}: copied`);
  }

  log.push(`\nDone! ${saveFiles.length} save(s) converted.`);
  return { files, log: log.join("\n") };
}
