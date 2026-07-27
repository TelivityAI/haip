import { describe, it, expect } from 'vitest';
import { validateCpf, formatCpf, calculateAge, checkFnrhComplete } from './index.js';

describe('CPF validation and formatting helpers', () => {
  it('should validate valid CPF numbers', () => {
    // Standard test CPFs
    expect(validateCpf('52998224725')).toBe(true);
    expect(validateCpf('529.982.247-25')).toBe(true);
  });

  it('should reject invalid CPF numbers', () => {
    expect(validateCpf('')).toBe(false);
    expect(validateCpf(null)).toBe(false);
    expect(validateCpf('11111111111')).toBe(false);
    expect(validateCpf('12345678901')).toBe(false);
    expect(validateCpf('123')).toBe(false);
  });

  it('should format 11-digit CPFs', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCpf('')).toBe('');
    expect(formatCpf(null)).toBe('');
    expect(formatCpf('ABC')).toBe('ABC');
  });
});

describe('calculateAge', () => {
  it('should calculate age correctly', () => {
    const today = new Date();
    const dob20 = new Date(today.getFullYear() - 20, today.getMonth(), today.getDate());
    expect(calculateAge(dob20)).toBe(20);

    const dobMinor = new Date(today.getFullYear() - 15, today.getMonth(), today.getDate());
    expect(calculateAge(dobMinor)).toBe(15);
  });

  it('should handle null/empty input', () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge('')).toBeNull();
    expect(calculateAge('invalid-date')).toBeNull();
  });
});

describe('checkFnrhComplete', () => {
  it('should return true for complete adult guest', () => {
    const guest = {
      firstName: 'Maria',
      lastName: 'Silva',
      taxId: '52998224725',
      gender: 'female',
      dateOfBirth: '1990-01-01',
    };
    expect(checkFnrhComplete(guest)).toBe(true);
  });

  it('should return false if name or taxId/doc is missing', () => {
    const guest = {
      firstName: 'Maria',
      gender: 'female',
    };
    expect(checkFnrhComplete(guest)).toBe(false);
  });

  it('should enforce guardian for minors when minorGuardianRequired is true', () => {
    const today = new Date();
    const minorDob = `${today.getFullYear() - 10}-01-01`;

    const minorWithoutGuardian = {
      firstName: 'Lucas',
      lastName: 'Silva',
      taxId: '52998224725',
      gender: 'male',
      dateOfBirth: minorDob,
      registrationData: {},
    };
    expect(checkFnrhComplete(minorWithoutGuardian, true)).toBe(false);

    const minorWithGuardian = {
      ...minorWithoutGuardian,
      registrationData: {
        guardianName: 'Maria Silva',
        guardianTaxId: '52998224725',
      },
    };
    expect(checkFnrhComplete(minorWithGuardian, true)).toBe(true);
  });

  it('should allow minors without guardian when minorGuardianRequired is false', () => {
    const today = new Date();
    const minorDob = `${today.getFullYear() - 10}-01-01`;

    const minorWithoutGuardian = {
      firstName: 'Lucas',
      lastName: 'Silva',
      taxId: '52998224725',
      gender: 'male',
      dateOfBirth: minorDob,
      registrationData: {},
    };
    expect(checkFnrhComplete(minorWithoutGuardian, false)).toBe(true);
  });
});
