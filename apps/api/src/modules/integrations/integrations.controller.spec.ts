import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { IntegrationsCatalogController } from './integrations.controller';
import { PropertyIntegrationsController } from './property-integrations.controller';

describe('Integrations controllers', () => {
  it('marks the public catalog controller as public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, IntegrationsCatalogController)).toBe(true);
  });

  it('does not mark the property integrations admin controller as public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PropertyIntegrationsController)).toBeUndefined();
  });
});
