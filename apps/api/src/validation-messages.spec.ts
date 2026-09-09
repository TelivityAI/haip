/**
 * Every 400 this API returns for a bad enum value must name the values it
 * would have accepted.
 *
 * WHY THIS EXISTS. `@IsEnum(['a','b'])` reads correctly and validates
 * correctly, but produces the message
 *
 *     type must be one of the following values:
 *
 * with nothing after the colon. class-validator's `IsEnum` is for TypeScript
 * enum OBJECTS: it validates with `Object.keys(entity).map(k => entity[k])`,
 * which happens to read an array's values, but it builds its message from
 * `Object.entries(entity).filter(([k]) => isNaN(parseInt(k)))`, which drops
 * every key of an array because array keys are all numeric. So the check
 * passes an array through and the message comes out empty. `@IsIn([...])` is
 * the decorator for a list of allowed values, and interpolates the list.
 *
 * Every enum decorator in the API was affected -- 88 across 64 files -- so a
 * client sending `type: "beverage"` was told only that it was wrong, never
 * that `food_beverage` exists.
 *
 * THE TEST READS METADATA, NOT SOURCE. Grepping for the decorator would only
 * find the spelling it was told to look for; class-validator's own registry
 * holds what will actually be evaluated at runtime, including the copies
 * PartialType and OmitType generate, which no grep sees.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { getMetadataStorage } from 'class-validator';

// Load every DTO so its decorators register. A file that is never imported
// contributes no metadata, which would make this test pass by not looking.
// `!**/*.spec.ts` matters: one DTO directory holds its own spec, and pulling
// it in here would run that file's `describe` blocks inside this one.
// Booking-requests lives in packages/ but its HTTP DTOs are still staff API
// 400 surfaces — include them so a future @IsEnum([...]) there cannot sneak
// past this guardrail.
const dtoModules = import.meta.glob(
  [
    './modules/**/dto/**/*.ts',
    '../../../packages/booking-requests/src/http/dto/**/*.ts',
    '!**/*.spec.ts',
  ],
  { eager: true },
);
interface Meta {
  // `type` is 'customValidation' for EVERY decorator built on ValidateBy,
  // which is all of them here. `name` is the discriminator. Filtering on
  // `type === 'isEnum'` matches nothing and makes this file pass while the
  // bug it exists to catch is present.
  type?: string;
  name?: string;
  target?: { name?: string };
  propertyName?: string;
  constraints?: unknown[];
}

function allMetadata(): Meta[] {
  const storage = getMetadataStorage() as unknown as {
    validationMetadatas: Map<unknown, Meta[]>;
  };
  const out: Meta[] = [];
  for (const list of storage.validationMetadatas.values()) out.push(...list);
  return out;
}

const describeSite = (m: Meta) => `${m.target?.name ?? '?'}.${m.propertyName ?? '?'}`;

describe('enum validation messages', () => {
  it('loaded the DTOs it is meant to be checking', () => {
    const loaded = Object.keys(dtoModules);
    expect(loaded.length).toBeGreaterThan(50);
    expect(loaded.some((path) => path.includes('booking-requests'))).toBe(true);
    expect(allMetadata().length).toBeGreaterThan(1000);
    // And is looking at constraints that exist: a filter that matches nothing
    // is the way this file fails silently, so assert it matches plenty.
    expect(allMetadata().filter((m) => m.name === 'isIn').length).toBeGreaterThan(50);
    // Booking-requests list DTO must be in the registry (not only on disk).
    expect(
      allMetadata().some((m) => m.target?.name === 'ListBookingRequestsDto' && m.name === 'isIn'),
    ).toBe(true);
  });

  it('never uses IsEnum with an array, whose message comes out empty', () => {
    const broken = allMetadata()
      .filter((m) => m.name === 'isEnum')
      .filter((m) => !Array.isArray(m.constraints?.[1]) || (m.constraints[1] as unknown[]).length === 0)
      .map(describeSite);
    expect(broken).toEqual([]);
  });

  it('gives every isIn constraint a non-empty list of allowed values', () => {
    const empty = allMetadata()
      .filter((m) => m.name === 'isIn')
      .filter((m) => !Array.isArray(m.constraints?.[0]) || (m.constraints[0] as unknown[]).length === 0)
      .map(describeSite);
    expect(empty).toEqual([]);
  });

  // The assertions above are about metadata. This one is about what a caller
  // actually reads, so a future refactor cannot satisfy the shape while still
  // producing an empty message.
  it('names the allowed values in the rendered message', async () => {
    const { validate } = await import('class-validator');
    const { CreateChargeDto } = await import('./modules/folio/dto/create-charge.dto');
    const dto = Object.assign(new CreateChargeDto(), {
      folioId: '00000000-0000-4000-8000-000000000000',
      type: 'beverage',
      description: 'a drink',
      amount: '1000',
      currencyCode: 'JPY',
    });
    const errors = await validate(dto, { skipMissingProperties: true });
    const message = Object.values(errors.find((e) => e.property === 'type')?.constraints ?? {}).join(' ');
    expect(message).toContain('food_beverage');
    expect(message).not.toMatch(/values:\s*$/);
  });
});
