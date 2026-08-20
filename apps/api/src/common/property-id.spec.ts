import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { resolvePropertyId } from './property-id';

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
