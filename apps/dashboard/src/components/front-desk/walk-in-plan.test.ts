import { describe, expect, it } from 'vitest';
import { planWalkInAssignments } from './walk-in-plan';

describe('planWalkInAssignments', () => {
  it('returns empty for no occupants', () => {
    expect(planWalkInAssignments([])).toEqual([]);
  });

  it('creates a single primary room reservation', () => {
    expect(
      planWalkInAssignments([{ guestId: 'g1', roomId: 'r1' }]),
    ).toEqual([{ type: 'create_primary', guestId: 'g1', roomId: 'r1' }]);
  });

  it('adds accompanying guests when they share the primary room', () => {
    expect(
      planWalkInAssignments([
        { guestId: 'g1', roomId: 'r1' },
        { guestId: 'g2', roomId: 'r1' },
      ]),
    ).toEqual([
      { type: 'create_primary', guestId: 'g1', roomId: 'r1' },
      { type: 'add_accompanying', guestId: 'g2', roomId: 'r1' },
    ]);
  });

  it('splits guests onto new rooms under the same booking', () => {
    expect(
      planWalkInAssignments([
        { guestId: 'g1', roomId: 'r1' },
        { guestId: 'g2', roomId: 'r2' },
        { guestId: 'g3', roomId: 'r2' },
      ]),
    ).toEqual([
      { type: 'create_primary', guestId: 'g1', roomId: 'r1' },
      { type: 'split_new_room', guestId: 'g2', roomId: 'r2' },
      { type: 'add_accompanying', guestId: 'g3', roomId: 'r2' },
    ]);
  });
});
