import { describe, expect, test } from "vitest";
import { lz4Decompress } from "./lz4";

describe("lz4Decompress valid blocks", () => {
  test("literal-only block decodes to abc", () => {
    // token=0x30 (3 literals), then 'a','b','c'
    const src = new Uint8Array([0x30, 0x61, 0x62, 0x63]);
    const result = lz4Decompress(src, 3);
    expect(result).toEqual(new Uint8Array([0x61, 0x62, 0x63]));
  });

  test("overlap block decodes to five 0x41 bytes", () => {
    // token=0x10 (1 literal), literal 'A', match offset=1 length=4 (0xf -> 0+4=4)
    const src = new Uint8Array([0x10, 0x41, 0x01, 0x00]);
    const result = lz4Decompress(src, 5);
    expect(result).toEqual(new Uint8Array([0x41, 0x41, 0x41, 0x41, 0x41]));
  });
});

describe("lz4Decompress malformed blocks", () => {
  test("truncated extended literal length rejects", () => {
    // token=0xf0 (15 literals, extended), then 0xff but no terminator
    const src = new Uint8Array([0xf0, 0xff]);
    expect(() => lz4Decompress(src, 100)).toThrow();
  });

  test("literal count beyond source rejects", () => {
    // token=0x50 (5 literals) but only 2 bytes follow
    const src = new Uint8Array([0x50, 0x41, 0x42]);
    expect(() => lz4Decompress(src, 5)).toThrow();
  });

  test("missing match offset byte rejects", () => {
    // token=0x00 (0 literals), then only one byte for offset
    const src = new Uint8Array([0x00, 0x01]);
    expect(() => lz4Decompress(src, 10)).toThrow();
  });

  test("zero match offset rejects", () => {
    // token=0x04 (match length 4+4=8, 0 literals), offset=0
    const src = new Uint8Array([0x04, 0x00, 0x00]);
    expect(() => lz4Decompress(src, 8)).toThrow();
  });

  test("match offset larger than produced output rejects", () => {
    // token=0x04 (0 literals, match length 8), offset=1 but no output produced yet
    const src = new Uint8Array([0x04, 0x01, 0x00]);
    expect(() => lz4Decompress(src, 8)).toThrow();
  });

  test("output overflow rejects", () => {
    // literal-only: token=0x30 (3 literals) but expected size is 2
    const src = new Uint8Array([0x30, 0x61, 0x62, 0x63]);
    expect(() => lz4Decompress(src, 2)).toThrow();
  });

  test("expected size mismatch rejects", () => {
    // literal-only: produces 3 bytes but expected 4
    const src = new Uint8Array([0x30, 0x61, 0x62, 0x63]);
    expect(() => lz4Decompress(src, 4)).toThrow();
  });

  test("negative expected size rejects", () => {
    const src = new Uint8Array([0x00]);
    expect(() => lz4Decompress(src, -1)).toThrow();
  });

  test("fractional expected size rejects", () => {
    const src = new Uint8Array([0x00]);
    expect(() => lz4Decompress(src, 1.5)).toThrow();
  });
});
