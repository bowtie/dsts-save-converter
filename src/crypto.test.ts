import { describe, expect, test } from "vitest";
import { decryptPc } from "./crypto";
import { PC_SAVE_SIZE } from "./types";

/** Build deterministic bytes from the index modulo 256. */
function deterministicBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = i % 256;
  return bytes;
}

describe("PC save crypto decryption", () => {
  test("decryptPc returns same length as input for a full PC save", () => {
    // Use deterministic bytes as a fake "encrypted" save — decryption will produce
    // gibberish but the length must match.
    const input = deterministicBytes(PC_SAVE_SIZE);
    const decrypted = decryptPc(input);
    expect(decrypted.length).toBe(PC_SAVE_SIZE);
  }, 30000);

  test("decryptPc is deterministic (same input → same output)", () => {
    const input = deterministicBytes(64);
    const decrypted1 = decryptPc(input);
    const decrypted2 = decryptPc(input);
    expect(decrypted1).toEqual(decrypted2);
  });
});

describe("AES block alignment validation", () => {
  test("decryptPc rejects non-block-aligned input", () => {
    const input = deterministicBytes(17);
    expect(() => decryptPc(input)).toThrow();
  });
});
