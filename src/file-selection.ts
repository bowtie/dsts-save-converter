/** Pure file-selection helper for conversion input. */

/** Check if a file is a valid save slot (0000-0015) or its metadata. */
function isValidSlot(name: string): boolean {
  const saveMatch = name.match(/^(\d{4})\.bin$/);
  if (saveMatch) return parseInt(saveMatch[1], 10) <= 15;
  const slotMatch = name.match(/^slot_(\d{4})\.bin$/);
  if (slotMatch) return parseInt(slotMatch[1], 10) <= 15;
  return false;
}

/**
 * Select which uploaded files should be passed to conversion.
 *
 * - Only save slots 0000-0015 and their slot_ metadata are considered.
 * - A numeric save (e.g. `0000.bin`) is included only when selected.
 * - Its matching `slot_0000.bin` metadata is included only when the
 *   corresponding save is selected.
 * - Output order matches input order.
 */
export function selectConversionFiles(
  files: readonly File[],
  selectedSaves: ReadonlySet<string>,
): File[] {
  return files.filter((file) => {
    const name = file.name;
    if (!isValidSlot(name)) return false;

    if (name.startsWith("slot_")) {
      const saveName = name.slice("slot_".length);
      return selectedSaves.has(saveName);
    }

    return selectedSaves.has(name);
  });
}
