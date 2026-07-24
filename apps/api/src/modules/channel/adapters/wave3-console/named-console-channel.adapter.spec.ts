import { describe, expect, it } from 'vitest';
import {
  NamedConsoleChannelAdapter,
  WAVE_CHANNEL_CONSOLE_PACKS,
} from './named-console-channel.adapter';

describe('WAVE_CHANNEL_CONSOLE_PACKS', () => {
  it('registers 11 Wave 3 channel console keys', () => {
    expect(WAVE_CHANNEL_CONSOLE_PACKS).toHaveLength(11);
    expect(WAVE_CHANNEL_CONSOLE_PACKS.map((p) => p.key)).toContain('yieldplanet');
  });
});

describe('NamedConsoleChannelAdapter', () => {
  it('runs ARI ops in console mode', async () => {
    const adapter = new NamedConsoleChannelAdapter('yieldplanet', 'YieldPlanet');
    expect(adapter.adapterType).toBe('yieldplanet');
    const result = await adapter.pushAvailability({
      propertyId: '11111111-1111-4111-8111-111111111111',
      channelConnectionId: '22222222-2222-4222-8222-222222222222',
      items: [
        {
          channelRoomCode: 'STD',
          date: '2026-08-01',
          available: 2,
          totalInventory: 5,
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.itemsSynced).toBe(1);
  });
});
