/** Core conversion logic: PC ↔ Switch save format. */
import { lz4Decompress, lz4Compress } from "./lz4";
import { decryptPc, encryptPc } from "./crypto";
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

/** Shift the outfit struct +4 bytes (PC→Switch) or -4 bytes (Switch→PC). */
function shiftOutfitStruct(body: Uint8Array, direction: "pc-to-switch" | "switch-to-pc"): void {
  const size = OUTFIT_STRUCT_SIZE;

  if (direction === "pc-to-switch") {
    const srcStart = OUTFIT_STRUCT_START;
    const dstStart = OUTFIT_STRUCT_START + 4;
    // Copy struct data +4 bytes forward (right to left to avoid overlap)
    for (let i = size - 1; i >= 0; i--) {
      body[dstStart + i] = body[srcStart + i];
    }
    // Zero the 4-byte gap at the original start
    for (let i = 0; i < 4; i++) {
      body[srcStart + i] = 0;
    }
  } else {
    const srcStart = OUTFIT_STRUCT_START + 4;
    const dstStart = OUTFIT_STRUCT_START;
    // Copy struct data -4 bytes backward (left to right to avoid overlap)
    for (let i = 0; i < size; i++) {
      body[dstStart + i] = body[srcStart + i];
    }
    // Zero the 4-byte gap at the end
    for (let i = 0; i < 4; i++) {
      body[dstStart + size + i] = 0;
    }
  }
}

/** Zero model data and appearance block (game fills at runtime). */
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

/** Restore the save-menu gender byte at 0x0FDC50 (the shift zeros it). */
function patchGenderOffset(body: Uint8Array, gender: number): void {
  body[GENDER_OFFSET] = gender;
}

// ── Auto-detection ─────────────────────────────────────────

export type Platform = "pc" | "switch" | "unknown";

/** Detect whether save files are PC or Switch format. */
export async function detectPlatform(files: File[]): Promise<Platform> {
  const saveFiles = files.filter((f) => /^\d{4}\.bin$/.test(f.name) && parseInt(f.name) <= 15);
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

/** Extract player name and playtime from slot_ metadata files. */
export async function extractSaveMeta(files: File[]): Promise<SaveFileMeta[]> {
  const slotFiles = files.filter(
    (f) => /^slot_\d{4}\.bin$/.test(f.name) && parseInt(f.name.slice(5)) <= 15,
  );

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

/** Parse and validate a Switch save header. */
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

/** Convert PC saves to Switch format. */
export async function convertPcToSwitch(pcFiles: File[]): Promise<ConversionResult> {
  const log: string[] = [];
  const files = new Map<string, Uint8Array>();

  const saveFiles = pcFiles.filter((f) => /^\d{4}\.bin$/.test(f.name) && parseInt(f.name) <= 15);
  const slotFiles = pcFiles.filter(
    (f) => /^slot_\d{4}\.bin$/.test(f.name) && parseInt(f.name.slice(5)) <= 15,
  );

  if (saveFiles.length === 0) throw new Error("No save .bin files found in PC files.");

  for (const file of saveFiles) {
    const encrypted = await readFile(file);
    if (encrypted.length !== PC_SAVE_SIZE) {
      log.push(`SKIP ${file.name}: wrong size ${encrypted.length}`);
      continue;
    }

    const decrypted = decryptPc(encrypted);
    if (decrypted.length !== PC_SAVE_SIZE) {
      throw new Error(
        `${file.name}: decrypted length ${decrypted.length} does not match PC_SAVE_SIZE ${PC_SAVE_SIZE}`,
      );
    }

    const header = decrypted.subarray(0, HEADER_SIZE);
    const binaryData = decrypted.subarray(HEADER_SIZE);
    if (binaryData.length !== BINARY_DATA_SIZE) {
      throw new Error(
        `${file.name}: binary length ${binaryData.length} does not match BINARY_DATA_SIZE ${BINARY_DATA_SIZE}`,
      );
    }

    const body = new Uint8Array(binaryData.length);
    body.set(binaryData);

    const gender = body[GENDER_OFFSET];
    if (gender !== 0 && gender !== 1) {
      throw new Error(
        `${file.name}: unrecognized gender value ${gender} at 0x${GENDER_OFFSET.toString(16).toUpperCase()}`,
      );
    }
    const isFemale = gender === 1;

    shiftOutfitStruct(body, "pc-to-switch");
    zeroModelRegions(body);
    patchGenderOffset(body, gender);

    const compressed = lz4Compress(body);

    const output = new Uint8Array(HEADER_SIZE + compressed.length);
    output.set(header, 0);
    output.set(compressed, HEADER_SIZE);
    files.set(file.name, output);

    const info = parseFileInfo(header);
    log.push(
      `${file.name}: -> ${output.length} bytes (player: ${info.playerName}, playtime: ${info.playtime}, ${isFemale ? "female" : "male"}) [converted]`,
    );
  }

  for (const file of slotFiles) {
    const data = await readFile(file);
    files.set(file.name, data);
    log.push(`${file.name}: copied`);
  }

  log.push(`\nDone! ${saveFiles.length} save(s) converted.`);
  return { files, log: log.join("\n") };
}

// ── Switch → PC ────────────────────────────────────────────

/** Convert Switch saves to PC format. */
export async function convertSwitchToPc(switchFiles: File[]): Promise<ConversionResult> {
  const log: string[] = [];
  const files = new Map<string, Uint8Array>();

  const saveFiles = switchFiles.filter(
    (f) => /^\d{4}\.bin$/.test(f.name) && parseInt(f.name) <= 15,
  );
  const slotFiles = switchFiles.filter(
    (f) => /^slot_\d{4}\.bin$/.test(f.name) && parseInt(f.name.slice(5)) <= 15,
  );

  if (saveFiles.length === 0) throw new Error("No save .bin files found in Switch files.");

  for (const file of saveFiles) {
    const raw = await readFile(file);
    if (raw.length <= HEADER_SIZE) {
      log.push(`SKIP ${file.name}: too short (${raw.length} bytes)`);
      continue;
    }

    const headerBytes = raw.subarray(0, HEADER_SIZE);
    parseSwitchHeader(headerBytes, file.name);

    const compressed = raw.subarray(HEADER_SIZE);
    const body = lz4Decompress(compressed, BINARY_DATA_SIZE);
    if (body.length !== BINARY_DATA_SIZE) {
      throw new Error(
        `${file.name}: decompressed length ${body.length} does not match BINARY_DATA_SIZE ${BINARY_DATA_SIZE}`,
      );
    }

    const header = new Uint8Array(HEADER_SIZE);
    header.set(headerBytes);

    const gender = body[GENDER_OFFSET];
    if (gender !== 0 && gender !== 1) {
      throw new Error(
        `${file.name}: unrecognized gender value ${gender} at 0x${GENDER_OFFSET.toString(16).toUpperCase()}`,
      );
    }
    const isFemale = gender === 1;

    shiftOutfitStruct(body, "switch-to-pc");
    zeroModelRegions(body);
    patchGenderOffset(body, gender);

    const combined = new Uint8Array(PC_SAVE_SIZE);
    combined.set(header, 0);
    combined.set(body, HEADER_SIZE);
    const output = encryptPc(combined);
    files.set(file.name, output);

    const info = parseFileInfo(header);
    log.push(
      `${file.name}: -> ${output.length} bytes (player: ${info.playerName}, playtime: ${info.playtime}, ${isFemale ? "female" : "male"}) [converted]`,
    );
  }

  for (const file of slotFiles) {
    const data = await readFile(file);
    files.set(file.name, data);
    log.push(`${file.name}: copied`);
  }

  log.push(`\nDone! ${saveFiles.length} save(s) converted.`);
  return { files, log: log.join("\n") };
}
