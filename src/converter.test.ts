import { describe, expect, test } from "vitest";
import { detectPlatform } from "./converter";
import { BINARY_DATA_SIZE, HEADER_SIZE, PC_SAVE_SIZE } from "./types";

/** Build a fake File with a given name and size. */
function fakeFile(name: string, size: number, content?: Uint8Array): File {
  const bytes = content ?? new Uint8Array(size);
  // In Node/Vitest, File may not be available; use Blob as a fallback cast
  if (typeof File !== "undefined") {
    return new File([bytes.buffer as ArrayBuffer], name);
  }
  return { name, size, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as File;
}

/** Build a valid 1024-byte Switch header with field 1 = BINARY_DATA_SIZE. */
function validSwitchHeader(): Uint8Array {
  const header = new Uint8Array(HEADER_SIZE);
  const text = `label, ${BINARY_DATA_SIZE}, extra, fields, here`;
  header.set(new TextEncoder().encode(text));
  return header;
}

describe("detectPlatform", () => {
  test("empty input returns unknown", async () => {
    expect(await detectPlatform([])).toBe("unknown");
  });

  test("metadata-only input returns unknown", async () => {
    const files = [fakeFile("slot_0000.bin", 720), fakeFile("system_data.bin", 500)];
    expect(await detectPlatform(files)).toBe("unknown");
  });

  test("exact PC-size numeric files return pc", async () => {
    const files = [fakeFile("0000.bin", PC_SAVE_SIZE), fakeFile("0001.bin", PC_SAVE_SIZE)];
    expect(await detectPlatform(files)).toBe("pc");
  });

  test("valid Switch header plus compressed byte returns switch", async () => {
    const header = validSwitchHeader();
    const content = new Uint8Array(HEADER_SIZE + 8);
    content.set(header, 0);
    // A few bytes of "compressed" data — detectPlatform only reads the header
    content[HEADER_SIZE] = 0x30;
    const files = [fakeFile("0000.bin", content.length, content)];
    expect(await detectPlatform(files)).toBe("switch");
  });

  test("a one-byte numeric .bin returns unknown", async () => {
    const files = [fakeFile("0.bin", 1)];
    expect(await detectPlatform(files)).toBe("unknown");
  });

  test("a random non-PC-size .bin returns unknown", async () => {
    const files = [fakeFile("0000.bin", 500, new Uint8Array(500))];
    expect(await detectPlatform(files)).toBe("unknown");
  });

  test("mixed PC and Switch candidates return unknown", async () => {
    const header = validSwitchHeader();
    const swContent = new Uint8Array(HEADER_SIZE + 8);
    swContent.set(header, 0);
    const files = [
      fakeFile("0000.bin", PC_SAVE_SIZE),
      fakeFile("0001.bin", swContent.length, swContent),
    ];
    expect(await detectPlatform(files)).toBe("unknown");
  });
});
