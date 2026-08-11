/**
 * Reading structured content out of plain forms.
 *
 * The authoring screens deliberately avoid client-side array widgets: a list
 * typed one-per-line survives a page reload, works without JavaScript, and is
 * far easier to paste into from the spreadsheet the team is migrating off.
 */

/** Non-empty, trimmed lines from a textarea. */
export function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Lines of `a | b | c`, split into trimmed columns.
 *
 * Missing trailing columns come back as empty strings so callers can index
 * without guarding.
 */
export function delimitedRows(
  value: FormDataEntryValue | null,
  columns: number,
  separator = "|",
): string[][] {
  return lines(value).map((line) => {
    const parts = line.split(separator).map((part) => part.trim());
    while (parts.length < columns) parts.push("");
    return parts.slice(0, columns);
  });
}

export function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Repeated fields named `prefix.0.field`, `prefix.1.field`, …
 *
 * Rows where every value is empty are dropped, which is what makes
 * "render the existing rows plus a couple of blank ones" work as an
 * add-a-row interaction without any client state.
 */
export function repeatedRows(
  formData: FormData,
  prefix: string,
  fields: string[],
): Record<string, string>[] {
  const indices = new Set<number>();
  for (const key of formData.keys()) {
    const match = new RegExp(`^${prefix}\\.(\\d+)\\.`).exec(key);
    if (match) indices.add(Number(match[1]));
  }

  return [...indices]
    .sort((a, b) => a - b)
    .map((index) =>
      Object.fromEntries(
        fields.map((field) => [field, String(formData.get(`${prefix}.${index}.${field}`) ?? "").trim()]),
      ),
    )
    .filter((row) => Object.values(row).some((value) => value.length > 0));
}
