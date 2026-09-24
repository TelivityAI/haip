/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, escaped quotes (""),
 * commas/newlines inside quotes, and CRLF/LF line endings. Returns an array of
 * row objects keyed by the header row. Dependency-free — migration files are
 * modest and this avoids pulling in a parser library.
 */

/** Common PMS export headers → HAIP canonical import fields. */
const HEADER_ALIASES: Record<string, string> = {
  'first name': 'firstName',
  firstname: 'firstName',
  'guest first name': 'firstName',
  'given name': 'firstName',
  'last name': 'lastName',
  lastname: 'lastName',
  surname: 'lastName',
  'guest last name': 'lastName',
  'family name': 'lastName',
  email: 'email',
  'e-mail': 'email',
  'guest email': 'email',
  'guest e-mail': 'email',
  'email address': 'email',
  phone: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  'phone number': 'phone',
  company: 'companyName',
  'company name': 'companyName',
  loyalty: 'loyaltyNumber',
  'loyalty number': 'loyaltyNumber',
  'loyalty #': 'loyaltyNumber',
  arrival: 'checkIn',
  'check in': 'checkIn',
  'check-in': 'checkIn',
  departure: 'checkOut',
  'check out': 'checkOut',
  'check-out': 'checkOut',
  'room type': 'roomTypeId',
  'room type id': 'roomTypeId',
  'rate plan': 'ratePlanId',
  'rate plan id': 'ratePlanId',
  'room number': 'number',
  'room #': 'number',
};

export function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map a source CSV header to a canonical field when it matches by name or alias. */
export function suggestCanonicalField(
  sourceHeader: string,
  canonicalFields: string[],
): string | undefined {
  const canonLower = new Map(canonicalFields.map((c) => [c.toLowerCase(), c]));
  const exact = canonLower.get(sourceHeader.trim().toLowerCase());
  if (exact) return exact;

  const alias = HEADER_ALIASES[normalizeHeaderKey(sourceHeader)];
  if (alias && canonLower.has(alias.toLowerCase())) {
    return canonLower.get(alias.toLowerCase());
  }
  return undefined;
}

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
 *
 * When `canonicalFields` is provided and a source column is unmapped, common
 * PMS header aliases are applied automatically.
 */
export function applyMapping(
  row: Record<string, string>,
  mapping?: Record<string, string>,
  canonicalFields?: string[],
): Record<string, string> {
  const out: Record<string, string> = { ...row };
  if (mapping) {
    for (const [source, canonical] of Object.entries(mapping)) {
      if (canonical && source in row) {
        out[canonical] = row[source]!;
      }
    }
  }
  if (canonicalFields?.length) {
    for (const source of Object.keys(row)) {
      const suggested = suggestCanonicalField(source, canonicalFields);
      if (suggested && (out[suggested] === undefined || out[suggested] === '')) {
        out[suggested] = row[source]!;
      }
    }
  }
  return out;
}
