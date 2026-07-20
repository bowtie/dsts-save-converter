/**
 * Core conversion logic: PC → Switch save format.
 *
 * The PC and Switch save formats are nearly identical at the binary level.
 * The only differences are:
 *
 * 1. Container: PC saves are AES-128-ECB encrypted; Switch saves use
 *    a plaintext header + LZ4-compressed body.
 *
 * 2. Outfit struct shift: The outfit struct (92 bytes at 0x0FDC10) is
 *    shifted +4 bytes on Switch. This moves gender, costume, and companion
 *    values to their correct Switch offsets.
 *
 * 3. Model data: The game initializes model/appearance data at runtime
 *    from gender + costume index, so we zero those regions (801 bytes).
 *    No reference save needed.
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
  GENDER_OFFSET,
  OUTFIT_STRUCT_START,
  OUTFIT_STRUCT_SIZE,
  MODEL_DATA_START,
  MODEL_DATA_SIZE,
  APPEARANCE_BLOCK_START,
  APPEARANCE_BLOCK_SIZE,
  parseHeaderText,
} from "./types";

export interface ConversionResult {
  files: Map<string, Uint8Array>;
  log: string;
}

// ── Patching ───────────────────────────────────────────────

/**
 * Shift the outfit struct +4 bytes for Switch.
 *
 * The outfit struct (0x0FDC10, 92 bytes) is shifted +4 on Switch relative
 * to PC. This moves gender (0x0FDC50→0x0FDC54), costume (0x0FDC54→0x0FDC58),
 * and companions to their correct Switch offsets. The gap at 0x0FDC10-0x0FDC13
 * is zeroed.
 */
function shiftOutfitStruct(body: Uint8Array): void {
  const srcStart = OUTFIT_STRUCT_START;
  const dstStart = OUTFIT_STRUCT_START + 4;
  const size = OUTFIT_STRUCT_SIZE;

  // Copy struct data +4 bytes forward (right to left to avoid overlap)
  for (let i = size - 1; i >= 0; i--) {
    body[dstStart + i] = body[srcStart + i];
  }
  // Zero the 4-byte gap at the original start
  for (let i = 0; i < 4; i++) {
    body[srcStart + i] = 0;
  }
}

/**
 * Zero model data and appearance block.
 *
 * The Switch game initializes these at runtime from gender + costume index.
 * Verified for both male and female: zeroed saves render correctly, the
 * game rewrites model data on area load, and the appearance block stays
 * zero permanently.
 */
function zeroModelRegions(body: Uint8Array): void {
  const regions: ReadonlyArray<readonly [number, number]> = [
    [MODEL_DATA_START, MODEL_DATA_SIZE],
    [APPEARANCE_BLOCK_START, APPEARANCE_BLOCK_SIZE],
  ];
  for (const [start, size] of regions) {
    for (let i = 0; i < size; i++) {
      body[start + i] = 0;
    }
  }
}

/**
 * Restore the save-menu gender byte at 0x0FDC50.
 *
 * The shift zeros this offset (it's the gap before the shifted struct).
 * We restore it from the original gender value.
 */
function patchGenderOffset(body: Uint8Array, gender: number): void {
  body[GENDER_OFFSET] = gender;
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

// ── PC → Switch ────────────────────────────────────────────

/**
 * Convert PC saves to Switch format.
 *
 * Steps per save file:
 * 1. AES-128-ECB decrypt
 * 2. Read gender from 0x0FDC50
 * 3. Shift outfit struct +4 (moves gender/costume/companions to Switch offsets)
 * 4. Zero model data and appearance block (game fills at runtime)
 * 5. Restore gender at 0x0FDC50 (shift zeros it)
 * 6. LZ4 compress
 *
 * @param pcFiles  All .bin files from the PC save folder
 * @returns Conversion result with output files and log
 */
export async function convertPcToSwitch(pcFiles: File[]): Promise<ConversionResult> {
  const log: string[] = [];
  const files = new Map<string, Uint8Array>();

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

    // Read gender before shift
    const gender = body[GENDER_OFFSET];
    if (gender !== 0 && gender !== 1) {
      throw new Error(
        `${file.name}: unrecognized gender value ${gender} at 0x${GENDER_OFFSET.toString(16).toUpperCase()}`,
      );
    }
    const isFemale = gender === 1;

    // Shift outfit struct +4 (moves gender/costume/companions to Switch offsets)
    shiftOutfitStruct(body);

    // Zero model data and appearance block (game fills at runtime)
    zeroModelRegions(body);

    // Restore save-menu gender at 0x0FDC50 (shift zeros it)
    patchGenderOffset(body, gender);

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
