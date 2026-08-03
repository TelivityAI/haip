import { describe, expect, it } from 'vitest';
import { formatParsedIdSummary, looksLikeIdSwipe, parseIdDocumentSwipe } from './id-document-swipe';

const SAMPLE_AAMVA = `@
ANSI 636000090002DL00410278ZV02990000DLDAQD1234567
DCSDOE
DACJOHN
DADJAMES
DBB01011990
DBA01012030
DAG123 MAIN ST
DAIANYTOWN
DAJCA
DAK902100000
DCGUSA
DBC1
`;

const SAMPLE_MRZ = `P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
L898902C36UTO7408122F1204159ZE184226B<<<<<10`;

const SAMPLE_TRACK1 = '%BC^DOE$JANE ANN^123 MAIN ST^?';

describe('parseIdDocumentSwipe', () => {
  it('parses AAMVA barcode text into guest fields', () => {
    const doc = parseIdDocumentSwipe(SAMPLE_AAMVA);
    expect(doc).toMatchObject({
      kind: 'aamva',
      firstName: 'John',
      lastName: 'Doe',
      middleName: 'James',
      dateOfBirth: '1990-01-01',
      idExpiry: '2030-01-01',
      idNumber: 'D1234567',
      idType: 'drivers_license',
      city: 'Anytown',
      stateProvince: 'CA',
      gender: 'male',
    });
    expect(looksLikeIdSwipe(SAMPLE_AAMVA)).toBe(true);
  });

  it('parses passport MRZ', () => {
    const doc = parseIdDocumentSwipe(SAMPLE_MRZ);
    expect(doc).toMatchObject({
      kind: 'mrz_passport',
      firstName: 'Anna',
      lastName: 'Eriksson',
      middleName: 'Maria',
      idType: 'passport',
      idNumber: 'L898902C3',
      dateOfBirth: '1974-08-12',
      idExpiry: '2012-04-15',
      gender: 'female',
    });
  });

  it('parses magstripe track 1 name', () => {
    const doc = parseIdDocumentSwipe(SAMPLE_TRACK1);
    expect(doc).toMatchObject({
      kind: 'magstripe',
      firstName: 'Jane',
      lastName: 'Doe',
      middleName: 'Ann',
    });
  });

  it('returns null for ordinary typed text', () => {
    expect(parseIdDocumentSwipe('John')).toBeNull();
    expect(looksLikeIdSwipe('John Doe')).toBe(false);
  });

  it('formats a short summary for the UI', () => {
    const doc = parseIdDocumentSwipe(SAMPLE_MRZ)!;
    expect(formatParsedIdSummary(doc)).toContain('Anna Eriksson');
    expect(formatParsedIdSummary(doc)).toContain('Passport');
  });
});
