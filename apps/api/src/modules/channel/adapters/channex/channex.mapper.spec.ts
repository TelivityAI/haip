import { describe, it, expect } from 'vitest';
import {
  collapseDateRanges,
  extractChannexTaskIds,
  mapAvailabilityToChannex,
  mapChannexRevisionToHaip,
  mapRatesToChannex,
  mapRestrictionsToChannex,
} from './channex.mapper';

describe('channex.mapper', () => {
  it('collapseDateRanges merges consecutive equal values', () => {
    const out = collapseDateRanges(
      [
        { date: '2026-11-01', v: 1 },
        { date: '2026-11-02', v: 1 },
        { date: '2026-11-03', v: 2 },
        { date: '2026-11-05', v: 2 },
      ],
      (a, b) => a.v === b.v,
    );
    expect(out).toEqual([
      { v: 1, date_from: '2026-11-01', date_to: '2026-11-02' },
      { v: 2, date: '2026-11-03' },
      { v: 2, date: '2026-11-05' },
    ]);
  });

  it('mapAvailabilityToChannex emits date ranges', () => {
    const values = mapAvailabilityToChannex('prop-1', [
      { channelRoomCode: 'RT1', date: '2026-11-10', available: 3, totalInventory: 5 },
      { channelRoomCode: 'RT1', date: '2026-11-11', available: 3, totalInventory: 5 },
      { channelRoomCode: 'RT1', date: '2026-11-12', available: 3, totalInventory: 5 },
    ]);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({
      property_id: 'prop-1',
      room_type_id: 'RT1',
      availability: 3,
      date_from: '2026-11-10',
      date_to: '2026-11-12',
    });
  });

  it('mapRatesToChannex uses decimal string rate', () => {
    const values = mapRatesToChannex('prop-1', [
      {
        channelRoomCode: 'RT1',
        channelRateCode: 'BAR',
        date: '2026-11-22',
        amount: 333,
        currencyCode: 'USD',
      },
    ]);
    expect(values[0]).toMatchObject({
      rate_plan_id: 'BAR',
      rate: '333.00',
      date: '2026-11-22',
    });
  });

  it('mapRestrictionsToChannex maps min stay to min_stay_arrival', () => {
    const values = mapRestrictionsToChannex('prop-1', [
      {
        channelRoomCode: 'RT1',
        channelRateCode: 'BAR',
        date: '2026-11-23',
        stopSell: false,
        closedToArrival: false,
        closedToDeparture: false,
        minLos: 3,
        maxLos: 0,
      },
    ]);
    expect(values[0]).toMatchObject({ min_stay_arrival: 3 });
    expect(values[0]!['max_stay']).toBeUndefined();
  });

  it('mapChannexRevisionToHaip keeps booking id + revision id', () => {
    const mapped = mapChannexRevisionToHaip(
      {
        id: 'rev-1',
        attributes: {
          status: 'modified',
          booking: {
            id: 'bk-1',
            property_id: 'prop-1',
            arrival_date: '2026-12-01',
            departure_date: '2026-12-03',
            amount: 100,
            currency: 'USD',
            customer: { name: 'A', surname: 'B' },
            rooms: [{ room_type_id: 'RT', rate_plan_id: 'RP', occupancy: { adults: 1, children: 0 } }],
          },
        },
      },
      'prop-1',
    );
    expect(mapped?.externalConfirmation).toBe('bk-1');
    expect(mapped?.externalRevisionId).toBe('rev-1');
    expect(mapped?.status).toBe('modified');
  });

  it('extractChannexTaskIds reads task list', () => {
    expect(
      extractChannexTaskIds({ data: [{ id: 't1', type: 'task' }, { id: 't2', type: 'task' }] }),
    ).toEqual(['t1', 't2']);
  });
});
