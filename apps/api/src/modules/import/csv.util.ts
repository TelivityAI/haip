/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes (""),
 * commas/newlines inside quotes, and CRLF/LF line endings. Returns an array of
 * row objects keyed by the header row. Dependency-free — migration files are
 * modest and this avoids pulling in a parser library.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]!;
    // Skip fully-empty lines.
    if (cells.length === 1 && cells[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]!] = (cells[c] ?? '').trim();
    }
    out.push(obj);
  }
  return out;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // swallow — handled by the following \n
    } else {
      field += ch;
    }
  }
  // Flush the final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Apply a header→canonical-field mapping to a parsed row. `mapping` maps a source
 * column name (as it appears in the CSV) to the importer's canonical field name.
 * Columns absent from the mapping pass through unchanged so a CSV whose headers
 * already match needs no mapping at all.
 */
export function applyMapping(
  row: Record<string, string>,
  mapping?: Record<string, string>,
): Record<string, string> {
  if (!mapping || Object.keys(mapping).length === 0) return row;
  const out: Record<string, string> = { ...row };
  for (const [source, canonical] of Object.entries(mapping)) {
    if (source in row) {
      out[canonical] = row[source]!;
    }
  }
  return out;
}
