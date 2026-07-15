/**
 * LZ4 block format compress/decompress.
 *
 * This is a browser-compatible port of the LZ4 block algorithm,
 * derived from lz4js (https://github.com/Benzinga/lz4js).
 *
 * The Switch save format uses raw LZ4 **block** compression (not frame),
 * so we expose block-level functions only.
 */

// ── Constants ──────────────────────────────────────────────
const MIN_MATCH = 4;
const MIN_LENGTH = 13;
const SEARCH_LIMIT = 5;
const SKIP_TRIGGER = 6;
const HASH_SIZE = 1 << 16;
const ML_BITS = 4;
const ML_MASK = (1 << ML_BITS) - 1;
const RUN_BITS = 4;
const RUN_MASK = (1 << RUN_BITS) - 1;

// ── Hashing helpers ────────────────────────────────────────
function hashU32(a: number): number {
  a = a | 0;
  a = (a + 2127912214 + (a << 12)) | 0;
  a = a ^ -949894596 ^ (a >>> 19);
  a = (a + 374761393 + (a << 5)) | 0;
  a = (a + -744332180) ^ (a << 9);
  a = (a + -42973499 + (a << 3)) | 0;
  return (a ^ -1252372727 ^ (a >>> 16)) | 0;
}

function readU32(buf: Uint8Array, n: number): number {
  return (buf[n] | (buf[n + 1] << 8) | (buf[n + 2] << 16) | (buf[n + 3] << 24)) >>> 0;
}

// ── Shared state ───────────────────────────────────────────
const hashTable = new Uint32Array(HASH_SIZE);

function clearHashTable(): void {
  hashTable.fill(0);
}

// ── Block decompress ───────────────────────────────────────
function decompressBlock(
  src: Uint8Array,
  dst: Uint8Array,
  sIndex: number,
  sLength: number,
  dIndex: number,
): number {
  const sEnd = sIndex + sLength;
  const dEnd = dst.length;

  while (sIndex < sEnd) {
    const token = src[sIndex++];

    // Copy literals
    let literalCount = token >> 4;
    if (literalCount > 0) {
      if (literalCount === 0xf) {
        while (true) {
          if (sIndex >= sEnd) throw new Error("LZ4: truncated extended literal length");
          literalCount += src[sIndex];
          if (src[sIndex++] !== 0xff) break;
        }
      }
      if (sIndex + literalCount > sEnd) throw new Error("LZ4: literal count exceeds source");
      if (dIndex + literalCount > dEnd)
        throw new Error("LZ4: literal output overflows destination");
      const n = sIndex + literalCount;
      while (sIndex < n) dst[dIndex++] = src[sIndex++];
    }

    if (sIndex >= sEnd) break;

    // Copy match
    if (sIndex + 2 > sEnd) throw new Error("LZ4: missing match offset bytes");
    const mOffset = src[sIndex++] | (src[sIndex++] << 8);
    if (mOffset === 0) throw new Error("LZ4: zero match offset");
    if (mOffset > dIndex) throw new Error("LZ4: match offset exceeds produced output");

    let mLength = token & 0xf;
    if (mLength === 0xf) {
      while (true) {
        if (sIndex >= sEnd) throw new Error("LZ4: truncated extended match length");
        mLength += src[sIndex];
        if (src[sIndex++] !== 0xff) break;
      }
    }
    mLength += MIN_MATCH;

    if (dIndex + mLength > dEnd) throw new Error("LZ4: match output overflows destination");

    let i = dIndex - mOffset;
    const n = i + mLength;
    while (i < n) dst[dIndex++] = dst[i++] | 0;
  }

  return dIndex;
}

// ── Block compress ─────────────────────────────────────────
function compressBlock(src: Uint8Array, dst: Uint8Array, sIndex: number, sLength: number): number {
  let dIndex = 0;
  const sEnd = sLength + sIndex;
  let mAnchor = sIndex;

  if (sLength >= MIN_LENGTH) {
    let searchMatchCount = (1 << SKIP_TRIGGER) + 3;

    while (sIndex + MIN_MATCH < sEnd - SEARCH_LIMIT) {
      const seq = readU32(src, sIndex);
      let hash = hashU32(seq) >>> 0;
      hash = (((hash >> 16) ^ hash) >>> 0) & 0xffff;

      const mIndex = hashTable[hash] - 1;
      hashTable[hash] = sIndex + 1;

      if (mIndex < 0 || (sIndex - mIndex) >>> 16 > 0 || readU32(src, mIndex) !== seq) {
        const mStep = searchMatchCount++ >> SKIP_TRIGGER;
        sIndex += mStep;
        continue;
      }

      searchMatchCount = (1 << SKIP_TRIGGER) + 3;
      const literalCount = sIndex - mAnchor;
      const mOffset = sIndex - mIndex;

      sIndex += MIN_MATCH;
      let mIndex2 = mIndex + MIN_MATCH;
      const mLengthStart = sIndex;
      while (sIndex < sEnd - SEARCH_LIMIT && src[sIndex] === src[mIndex2]) {
        sIndex++;
        mIndex2++;
      }
      const mLength = sIndex - mLengthStart;

      // Write token + literal count
      const token = mLength < ML_MASK ? mLength : ML_MASK;
      if (literalCount >= RUN_MASK) {
        dst[dIndex++] = (RUN_MASK << ML_BITS) + token;
        let n = literalCount - RUN_MASK;
        for (; n >= 0xff; n -= 0xff) dst[dIndex++] = 0xff;
        dst[dIndex++] = n;
      } else {
        dst[dIndex++] = (literalCount << ML_BITS) + token;
      }

      // Write literals
      for (let i = 0; i < literalCount; i++) dst[dIndex++] = src[mAnchor + i];

      // Write offset
      dst[dIndex++] = mOffset;
      dst[dIndex++] = mOffset >> 8;

      // Write match length
      if (mLength >= ML_MASK) {
        let n = mLength - ML_MASK;
        for (; n >= 0xff; n -= 0xff) dst[dIndex++] = 0xff;
        dst[dIndex++] = n;
      }

      mAnchor = sIndex;
    }
  }

  // Nothing was encoded — all literals
  if (mAnchor === 0) return 0;

  // Write remaining literals
  const literalCount = sEnd - mAnchor;
  if (literalCount >= RUN_MASK) {
    dst[dIndex++] = RUN_MASK << ML_BITS;
    let n = literalCount - RUN_MASK;
    for (; n >= 0xff; n -= 0xff) dst[dIndex++] = 0xff;
    dst[dIndex++] = n;
  } else {
    dst[dIndex++] = literalCount << ML_BITS;
  }

  while (mAnchor < sEnd) dst[dIndex++] = src[mAnchor++];

  return dIndex;
}

// ── Public API ─────────────────────────────────────────────

/**
 * Decompress a raw LZ4 block.
 * @param src compressed data
 * @param uncompressedSize expected output size (non-negative integer)
 */
export function lz4Decompress(src: Uint8Array, uncompressedSize: number): Uint8Array {
  if (!Number.isInteger(uncompressedSize) || uncompressedSize < 0) {
    throw new Error(`LZ4: invalid uncompressed size ${uncompressedSize}`);
  }
  const dst = new Uint8Array(uncompressedSize);
  const size = decompressBlock(src, dst, 0, src.length, 0);
  if (size !== uncompressedSize) {
    throw new Error(`LZ4: produced ${size} bytes but expected ${uncompressedSize}`);
  }
  return dst.subarray(0, size);
}

/**
 * Compress data as a raw LZ4 block.
 * @param src uncompressed data
 */
export function lz4Compress(src: Uint8Array): Uint8Array {
  const bound = (src.length + src.length / 255 + 16) | 0;
  const dst = new Uint8Array(bound);
  clearHashTable();
  const size = compressBlock(src, dst, 0, src.length);
  if (size === 0) {
    // No matches found — store as literal-only block
    const out = new Uint8Array(src.length);
    out.set(src);
    return out;
  }
  return dst.subarray(0, size);
}
