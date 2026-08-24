import { describe, it, expect } from 'vitest';
import {
  INTEGRATION_PROFILES,
  integrationPrincipalEmail,
  isValidKeycloakSub,
  slugifyIntegrationLabel,
} from './integration-principal.js';

describe('integration-principal helpers', () => {
  it('slugifyIntegrationLabel normalizes labels', () => {
    expect(slugifyIntegrationLabel('Enquiry Pipeline')).toBe('enquiry-pipeline');
    expect(slugifyIntegrationLabel('  foo/bar!!  ')).toBe('foo-bar');
  });

  it('integrationPrincipalEmail uses svc slug domain', () => {
    expect(integrationPrincipalEmail('Enquiry Pipeline')).toBe(
      'svc-enquiry-pipeline@integrations.local',
    );
  });

  it('isValidKeycloakSub accepts UUIDs', () => {
    expect(isValidKeycloakSub('a0000001-0000-4000-a000-000000000001')).toBe(true);
    expect(isValidKeycloakSub('not-a-uuid')).toBe(false);
  });

  it('INTEGRATION_PROFILES match catalog intent', () => {
    expect(INTEGRATION_PROFILES.inventory.permissions).toEqual([
      'rooms.read',
      'rooms.write',
      'ops.manage',
    ]);
    expect(INTEGRATION_PROFILES.reservations.permissions).toContain('reservations.write');
    expect(INTEGRATION_PROFILES.reservations.permissions).not.toContain('folios.manage');
  });
});
