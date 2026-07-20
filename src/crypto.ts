/**
 * AES-128-ECB encryption/decryption for PC save files.
 *
 * PC saves are encrypted with AES-128-ECB using a fixed key.
 * This module wraps crypto-js for use in the browser.
 */
import CryptoJS from "crypto-js";

const AES_KEY_HEX = "33393632373736373534353535383833";

const key = CryptoJS.enc.Hex.parse(AES_KEY_HEX);

function u8ToWordArray(u8: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < u8.length; i++) {
    words[i >>> 2] |= u8[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, u8.length);
}

function wordArrayToU8(wa: CryptoJS.lib.WordArray): Uint8Array {
  const bytes = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) {
    bytes[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return bytes;
}

/** AES-ECB without padding requires input lengths divisible by the 16-byte block size. */
function assertBlockAligned(data: Uint8Array): void {
  if (data.length % 16 !== 0) {
    throw new Error(`AES block alignment required: received ${data.length} bytes`);
  }
}

/** Decrypt a PC save file (AES-128-ECB, no padding). */
export function decryptPc(data: Uint8Array): Uint8Array {
  assertBlockAligned(data);
  // Raw ciphertext bytes must be wrapped in CipherParams for CryptoJS to read them correctly.
  const ciphertext = CryptoJS.lib.CipherParams.create({
    ciphertext: u8ToWordArray(data),
  });
  const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding,
  });
  const result = wordArrayToU8(decrypted);
  if (result.length !== data.length) {
    throw new Error(`Decrypted length ${result.length} does not match input ${data.length}`);
  }
  return result;
}

/** Encrypt a PC save file (AES-128-ECB, no padding). */
export function encryptPc(data: Uint8Array): Uint8Array {
  assertBlockAligned(data);
  const encrypted = CryptoJS.AES.encrypt(u8ToWordArray(data), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding,
  });
  const result = wordArrayToU8(encrypted.ciphertext);
  if (result.length !== data.length) {
    throw new Error(`Encrypted length ${result.length} does not match input ${data.length}`);
  }
  return result;
}
