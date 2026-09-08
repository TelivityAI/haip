import { describe, it, expect } from 'vitest';
import {
  PERMISSION_KEYS,
  ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  isPermissionKey,
} from './permissions-catalog.js';

describe('shared permissions catalog', () => {
  it('payments.refund exists and is withheld from night_auditor', () => {
    expect(isPermissionKey('payments.refund')).toBe(true);
    expect(PERMISSION_KEYS).toContain('payments.refund');
    expect(ROLE_DEFAULT_PERMISSIONS['night_auditor']).not.toContain('payments.refund');
    expect(ROLE_DEFAULT_PERMISSIONS['accounting']).toContain('payments.refund');
    expect(ROLE_DEFAULT_PERMISSIONS['front_desk']).toContain('payments.refund');
    expect(SYSTEM_ROLE_KEYS).toContain('night_auditor');
  });
});
