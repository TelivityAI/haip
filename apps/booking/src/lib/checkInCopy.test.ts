import { describe, expect, it } from 'vitest';
import { checkInCopy, resolveCheckInLocale } from './checkInCopy';

describe('checkInCopy signature strings', () => {
  it('resolves fr locale from navigator language', () => {
    expect(resolveCheckInLocale('fr-FR')).toBe('fr');
    expect(resolveCheckInLocale('en-US')).toBe('en');
  });

  it('exposes EN + FR signature pad copy', () => {
    const en = checkInCopy('en');
    const fr = checkInCopy('fr');
    expect(en.signature).toMatch(/signature/i);
    expect(en.signatureClear).toBeTruthy();
    expect(en.paperSignedFallback).toMatch(/paper/i);
    expect(fr.signature).toMatch(/signature/i);
    expect(fr.signatureHint).toMatch(/doigt|souris/i);
    expect(fr.paperSignedFallback).toMatch(/papier/i);
  });
});
