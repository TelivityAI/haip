import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { resolvePropertyId, resolveRequestPropertyId } from './property-id';

const A = 'a0000001-0000-4000-a000-000000000001';
const B = 'b0000001-0000-4000-a000-000000000001';

describe('resolvePropertyId', () => {
  it('uses body when only body is present', () => {
    expect(resolvePropertyId({ body: A })).toBe(A);
  });

  it('uses query when only query is present', () => {
    expect(resolvePropertyId({ query: A })).toBe(A);
  });

  it('prefers body when body and query match', () => {
    expect(resolvePropertyId({ body: A, query: A })).toBe(A);
  });

  it('rejects conflicting body and query', () => {
    expect(() => resolvePropertyId({ body: A, query: B })).toThrow(BadRequestException);
    expect(() => resolvePropertyId({ body: A, query: B })).toThrow(
      /query and body must match/,
    );
  });

  it('rejects when neither is present', () => {
    expect(() => resolvePropertyId({})).toThrow(BadRequestException);
    expect(() => resolvePropertyId({ body: null, query: '' })).toThrow(
      /propertyId is required/,
    );
  });
});

describe('resolveRequestPropertyId', () => {
  it('returns undefined when no location carries propertyId', () => {
    expect(resolveRequestPropertyId({})).toBeUndefined();
  });

  it('accepts a single query propertyId', () => {
    expect(resolveRequestPropertyId({ query: A })).toBe(A);
  });

  it('requires query, body, and params to match when more than one is set', () => {
    expect(resolveRequestPropertyId({ query: A, body: A, params: A })).toBe(A);
    expect(() => resolveRequestPropertyId({ query: A, body: B })).toThrow(BadRequestException);
    expect(() => resolveRequestPropertyId({ query: A, body: B })).toThrow(
      /query, body, and route params must match/,
    );
  });

  it('rejects non-scalar propertyId (duplicated query)', () => {
    expect(() => resolveRequestPropertyId({ query: [A, B] })).toThrow(ForbiddenException);
  });
});
