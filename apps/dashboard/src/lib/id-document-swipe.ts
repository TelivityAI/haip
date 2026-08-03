/**
 * Parse keyboard-wedge / HID output from hotel ID & passport readers.
 *
 * Supported payloads (what MagTek, ID TECH, Thales, etc. typically type):
 * - AAMVA DL/ID barcode text (starts with `@` + ANSI …)
 * - Passport / travel-doc MRZ (TD3 `P<…` or TD1 `I<…` / `A<…` / `C<…`)
 * - Magstripe Track 1 (`%…^LAST$FIRST^…?`)
 */

export type IdDocumentKind = 'aamva' | 'mrz_passport' | 'mrz_id' | 'magstripe';

export interface ParsedIdDocument {
  kind: IdDocumentKind;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  dateOfBirth?: string;
  idType?: string;
  idNumber?: string;
  idCountry?: string;
  idExpiry?: string;
  addressLine1?: string;
  city?: string;
  stateProvince?: string;
  postalCode?: string;
  nationality?: string;
  gender?: string;
}

function titleCaseName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .replace(/\s+/g, ' ');
}

function aamvaDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 8) return undefined;
  // Most US jurisdictions: MMDDYYYY
  const mm = digits.slice(0, 2);
  const dd = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const asMmDd = `${yyyy}-${mm}-${dd}`;
  if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
    return asMmDd;
  }
  // Fallback YYYYMMDD
  const y2 = digits.slice(0, 4);
  const m2 = digits.slice(4, 6);
  const d2 = digits.slice(6, 8);
  if (Number(m2) >= 1 && Number(m2) <= 12) return `${y2}-${m2}-${d2}`;
  return undefined;
}

function mrzDate(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  // Passports: years 00–30 → 2000s, else 1900s (good enough for desk intake)
  const century = yy <= 30 ? 2000 : 1900;
  return `${century + yy}-${mm}-${dd}`;
}

function mrzSex(raw: string): string | undefined {
  if (raw === 'M') return 'male';
  if (raw === 'F') return 'female';
  return undefined;
}

const AAMVA_CODES = [
  'DCS',
  'DAC',
  'DAD',
  'DBB',
  'DBA',
  'DAQ',
  'DAG',
  'DAI',
  'DAJ',
  'DAK',
  'DCG',
  'DBC',
  'DCT',
  'DAA',
  'DAB',
  'DAF',
  'DCF',
] as const;

function parseAamvaFields(raw: string): Record<string, string> {
  const text = raw.replace(/\r/g, '');
  const fields: Record<string, string> = {};
  const hits: { code: string; start: number; valueStart: number }[] = [];
  for (const code of AAMVA_CODES) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(code, from);
      if (at === -1) break;
      hits.push({ code, start: at, valueStart: at + 3 });
      from = at + 3;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const value = text
      .slice(hits[i].valueStart, end)
      .replace(/^\n+/, '')
      .split('\n')[0]
      .trim();
    if (value && !fields[hits[i].code]) fields[hits[i].code] = value;
  }
  return fields;
}

function parseAamva(raw: string): ParsedIdDocument | null {
  if (!raw.includes('ANSI') && !/^@/.test(raw.trim()) && !/\bDCS|\bDAQ|\bDAC|\bDCT/.test(raw)) {
    return null;
  }
  const f = parseAamvaFields(raw);
  let lastName = f.DCS || f.DAB;
  let firstName = f.DAC || f.DCT || f.DAF;
  let middleName = f.DAD;
  if (!firstName && f.DAA) {
    // Older: LAST,FIRST,MIDDLE
    const parts = f.DAA.split(',').map((p) => p.trim());
    lastName = lastName || parts[0];
    firstName = parts[1];
    middleName = middleName || parts[2];
  }
  if (!lastName && !firstName) return null;

  const sexRaw = f.DBC;
  const gender =
    sexRaw === '1' || sexRaw === 'M' ? 'male' : sexRaw === '2' || sexRaw === 'F' ? 'female' : undefined;

  return {
    kind: 'aamva',
    firstName: firstName ? titleCaseName(firstName.replace(/,/g, ' ')) : undefined,
    lastName: lastName ? titleCaseName(lastName.replace(/,/g, ' ')) : undefined,
    middleName: middleName ? titleCaseName(middleName.replace(/,/g, ' ')) : undefined,
    dateOfBirth: aamvaDate(f.DBB),
    idExpiry: aamvaDate(f.DBA),
    idNumber: f.DAQ || f.DCF,
    idType: 'drivers_license',
    idCountry: (f.DCG || 'USA').slice(0, 3).toUpperCase() === 'USA' ? 'US' : f.DCG?.slice(0, 2),
    addressLine1: f.DAG ? titleCaseName(f.DAG) : undefined,
    city: f.DAI ? titleCaseName(f.DAI) : undefined,
    stateProvince: f.DAJ?.toUpperCase(),
    postalCode: f.DAK?.replace(/\D/g, '').slice(0, 10) || undefined,
    gender,
  };
}

function parseMrzNames(nameField: string): { lastName?: string; firstName?: string; middleName?: string } {
  const [surnamePart, givenPart] = nameField.split('<<');
  const lastName = surnamePart?.replace(/</g, ' ').trim();
  const givens = (givenPart || '')
    .split('<')
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    lastName: lastName ? titleCaseName(lastName) : undefined,
    firstName: givens[0] ? titleCaseName(givens[0]) : undefined,
    middleName: givens.length > 1 ? titleCaseName(givens.slice(1).join(' ')) : undefined,
  };
}

function parseMrz(raw: string): ParsedIdDocument | null {
  const lines = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim().toUpperCase())
    .filter((l) => /^[A-Z0-9<]{20,}$/.test(l));

  // Also accept single-line paste with spaces removed between MRZ lines
  if (lines.length < 2) {
    const compact = raw.replace(/\s+/g, '').toUpperCase();
    const td3 = compact.match(/^(P[A-Z<][A-Z]{3}[A-Z<]{39})([A-Z0-9<]{44})$/);
    if (td3) {
      return parseMrzTd3(td3[1], td3[2]);
    }
    return null;
  }

  const line0 = lines[0];
  if (line0.startsWith('P') && lines[1]?.length >= 44) {
    return parseMrzTd3(line0.padEnd(44, '<').slice(0, 44), lines[1].padEnd(44, '<').slice(0, 44));
  }
  if (/^[ACI]/.test(line0) && lines.length >= 3) {
    return parseMrzTd1(lines[0], lines[1], lines[2]);
  }
  return null;
}

function parseMrzTd3(line1: string, line2: string): ParsedIdDocument | null {
  if (line1.length < 44 || line2.length < 44) return null;
  const names = parseMrzNames(line1.slice(5));
  if (!names.lastName && !names.firstName) return null;
  const idNumber = line2.slice(0, 9).replace(/</g, '');
  const nationality = line2.slice(10, 13).replace(/</g, '');
  const dob = mrzDate(line2.slice(13, 19));
  const gender = mrzSex(line2.slice(20, 21));
  const expiry = mrzDate(line2.slice(21, 27));
  const issuer = line1.slice(2, 5).replace(/</g, '');
  return {
    kind: 'mrz_passport',
    ...names,
    idType: 'passport',
    idNumber: idNumber || undefined,
    idCountry: issuer || nationality || undefined,
    nationality: nationality || undefined,
    dateOfBirth: dob,
    idExpiry: expiry,
    gender,
  };
}

function parseMrzTd1(line1: string, line2: string, line3: string): ParsedIdDocument | null {
  const names = parseMrzNames(line3);
  if (!names.lastName && !names.firstName) return null;
  const idNumber = line1.slice(5, 14).replace(/</g, '');
  const dob = mrzDate(line2.slice(0, 6));
  const gender = mrzSex(line2.slice(7, 8));
  const expiry = mrzDate(line2.slice(8, 14));
  const nationality = line2.slice(15, 18).replace(/</g, '');
  return {
    kind: 'mrz_id',
    ...names,
    idType: 'national_id',
    idNumber: idNumber || undefined,
    idCountry: nationality || undefined,
    nationality: nationality || undefined,
    dateOfBirth: dob,
    idExpiry: expiry,
    gender,
  };
}

function parseMagstripe(raw: string): ParsedIdDocument | null {
  // Track 1: %BC^LAST$FIRST MIDDLE^ADDRESS^?
  const track1 = raw.match(/%[^^]*\^([^?]*)\?/);
  const payload = track1?.[1] ?? (raw.includes('^') && raw.includes('$') ? raw : null);
  if (!payload) return null;
  const nameSeg = payload.split('^')[0] ?? '';
  if (!nameSeg.includes('$')) return null;
  const [last, rest] = nameSeg.split('$');
  const given = (rest || '').trim().split(/\s+/);
  const firstName = given[0];
  const middleName = given.length > 1 ? given.slice(1).join(' ') : undefined;
  if (!last && !firstName) return null;
  return {
    kind: 'magstripe',
    firstName: firstName ? titleCaseName(firstName) : undefined,
    lastName: last ? titleCaseName(last) : undefined,
    middleName: middleName ? titleCaseName(middleName) : undefined,
    idType: 'drivers_license',
  };
}

/** True when buffer looks like reader output rather than slow human typing. */
export function looksLikeIdSwipe(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 20) return false;
  if (s.startsWith('@') || s.includes('ANSI ')) return true;
  if (/%[^%]{5,}\?/.test(s) || (s.includes('^') && s.includes('$'))) return true;
  if (/^P[A-Z<]/.test(s.replace(/\s+/g, '')) || /^[ACI][A-Z<]/.test(s.replace(/\s+/g, ''))) return true;
  if (/\bDCS[A-Z]|\bDAQ[A-Z0-9]|\bDAC[A-Z]/.test(s)) return true;
  return false;
}

export function parseIdDocumentSwipe(raw: string): ParsedIdDocument | null {
  const cleaned = raw.replace(/\u0000/g, '').trim();
  if (!cleaned) return null;

  return parseAamva(cleaned) || parseMrz(cleaned) || parseMagstripe(cleaned);
}

export function formatParsedIdSummary(doc: ParsedIdDocument): string {
  const name = [doc.firstName, doc.lastName].filter(Boolean).join(' ') || 'Guest';
  const kind =
    doc.kind === 'mrz_passport'
      ? 'Passport'
      : doc.kind === 'aamva' || doc.kind === 'magstripe'
        ? "Driver's license"
        : 'ID';
  const id = doc.idNumber ? ` · ${doc.idNumber}` : '';
  return `${name} · ${kind}${id}`;
}
