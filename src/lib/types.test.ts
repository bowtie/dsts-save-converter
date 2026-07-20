import { describe, expect, test } from "vitest";
import { HEADER_SIZE, base64ToUint8Array, parseHeaderText } from "./types";

describe("parseHeaderText", () => {
  test("stops at the first null byte", () => {
    const bytes = new Uint8Array(HEADER_SIZE);
    const text = "hello, world";
    bytes.set(new TextEncoder().encode(text));
    expect(parseHeaderText(bytes)).toBe(text);
  });

  test("returns the full buffer when no null byte is present", () => {
    const text = "a".repeat(HEADER_SIZE);
    const bytes = new TextEncoder().encode(text);
    expect(parseHeaderText(bytes)).toBe(text);
  });
});

describe("base64ToUint8Array", () => {
  test("decodes a small deterministic byte sequence", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    // Convert to base64 manually without relying on Buffer in case of edge runtimes.
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary);
    expect(base64ToUint8Array(b64)).toEqual(bytes);
  });
});
