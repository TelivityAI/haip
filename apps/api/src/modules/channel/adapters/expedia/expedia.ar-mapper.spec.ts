import { describe, it, expect } from 'vitest';
import {
  mapAvailabilityToExpedia,
  mapRatesToExpedia,
} from './expedia.ar-mapper';

describe('expedia AR mapper', () => {
  it('maps availability with in-body auth, hotel id, and per-room updates', () => {
    const body: any = mapAvailabilityToExpedia('EXP-1', 'u', 'p', [
      { channelRoomCode: 'EXP_STD', date: '2026-07-01', available: 5, totalInventory: 10 },
    ]);
    expect(body.Authentication['@_username']).toBe('u');
    expect(body.Authentication['@_password']).toBe('p');
    expect(body.Hotel['@_id']).toBe('EXP-1');
    expect(body.RoomType[0]['@_id']).toBe('EXP_STD');
    expect(body.RoomType[0].AvailRateUpdate.RoomTypeUpdate['@_availableRooms']).toBe(5);
  });

  it('maps rates with rate plan id and currency/amount', () => {
    const body: any = mapRatesToExpedia('EXP-1', 'u', 'p', [
      { channelRoomCode: 'EXP_STD', channelRateCode: 'EXP_RACK', date: '2026-07-01', amount: 199, currencyCode: 'USD' },
    ]);
    const rt = body.RoomType[0];
    expect(rt.RatePlan['@_id']).toBe('EXP_RACK');
    expect(rt.RatePlan.AvailRateUpdate.Rate.RoomRate['@_rate']).toBe(199);
    expect(rt.RatePlan.AvailRateUpdate.Rate.RoomRate['@_currency']).toBe('USD');
  });
});
