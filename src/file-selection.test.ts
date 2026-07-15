import { describe, expect, test } from "vitest";
import { selectConversionFiles } from "./file-selection";

/** Build a lightweight fake File that only carries a name. */
const file = (name: string): File => ({ name }) as File;

describe("selectConversionFiles", () => {
  test("selecting one save includes that save and its matching metadata only", () => {
    const files = [
      file("0000.bin"),
      file("slot_0000.bin"),
      file("0001.bin"),
      file("slot_0001.bin"),
    ];
    const selected = new Set(["0000.bin"]);
    expect(selectConversionFiles(files, selected).map((f) => f.name)).toEqual([
      "0000.bin",
      "slot_0000.bin",
    ]);
  });

  test("selecting two saves includes both saves and both matching metadata files", () => {
    const files = [
      file("0000.bin"),
      file("slot_0000.bin"),
      file("0001.bin"),
      file("slot_0001.bin"),
    ];
    const selected = new Set(["0000.bin", "0001.bin"]);
    expect(selectConversionFiles(files, selected).map((f) => f.name)).toEqual([
      "0000.bin",
      "slot_0000.bin",
      "0001.bin",
      "slot_0001.bin",
    ]);
  });

  test("metadata is excluded when its save is not selected, even with no matching save file", () => {
    const files = [file("slot_0002.bin"), file("0000.bin"), file("slot_0000.bin")];
    const selected = new Set(["0000.bin"]);
    expect(selectConversionFiles(files, selected).map((f) => f.name)).toEqual([
      "0000.bin",
      "slot_0000.bin",
    ]);
  });

  test("system_data.bin and sysdata_dx11.bin remain included regardless of selection", () => {
    const files = [file("system_data.bin"), file("sysdata_dx11.bin"), file("0000.bin")];
    const selected = new Set<string>();
    expect(selectConversionFiles(files, selected).map((f) => f.name)).toEqual([
      "system_data.bin",
      "sysdata_dx11.bin",
    ]);
  });

  test("input order is preserved", () => {
    const files = [
      file("slot_0001.bin"),
      file("system_data.bin"),
      file("0001.bin"),
      file("0000.bin"),
      file("slot_0000.bin"),
    ];
    const selected = new Set(["0000.bin", "0001.bin"]);
    expect(selectConversionFiles(files, selected).map((f) => f.name)).toEqual([
      "slot_0001.bin",
      "system_data.bin",
      "0001.bin",
      "0000.bin",
      "slot_0000.bin",
    ]);
  });

  test("an empty selected set returns only the two system files if present", () => {
    const files = [
      file("0000.bin"),
      file("slot_0000.bin"),
      file("system_data.bin"),
      file("sysdata_dx11.bin"),
    ];
    const selected = new Set<string>();
    expect(selectConversionFiles(files, selected).map((f) => f.name)).toEqual([
      "system_data.bin",
      "sysdata_dx11.bin",
    ]);
  });
});
