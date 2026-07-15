/** Pure file-selection helper for conversion input. */

const SYSTEM_FILES = new Set(["system_data.bin", "sysdata_dx11.bin"]);

/**
 * Select which uploaded files should be passed to conversion.
 *
 * - A numeric save (e.g. `0000.bin`) is included only when selected.
 * - Its matching `slot_0000.bin` metadata is included only when the
 *   corresponding save is selected. The slot prefix is stripped once.
 * - `system_data.bin` and `sysdata_dx11.bin` are always included.
 * - Any other file is included only when its exact name is selected.
 * - Output order matches input order.
 */
export function selectConversionFiles(
  files: readonly File[],
  selectedSaves: ReadonlySet<string>,
): File[] {
  return files.filter((file) => {
    const name = file.name;

    if (SYSTEM_FILES.has(name)) return true;

    if (name.startsWith("slot_")) {
      const saveName = name.slice("slot_".length);
      return selectedSaves.has(saveName);
    }

    return selectedSaves.has(name);
  });
}
