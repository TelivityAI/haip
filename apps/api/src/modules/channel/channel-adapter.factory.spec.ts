import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ChannelAdapterFactory } from './channel-adapter.factory';
import { MockChannelAdapter } from './adapters/mock.adapter';
import { BookingComAdapter } from './adapters/booking-com/booking-com.adapter';
import { SiteMinderAdapter } from './adapters/siteminder/siteminder.adapter';
import { ExpediaAdapter } from './adapters/expedia/expedia.adapter';
import { DerbySoftAdapter } from './adapters/derbysoft/derbysoft.adapter';
import { Beds24Adapter } from './adapters/beds24/beds24.adapter';
import { ChannexAdapter } from './adapters/channex/channex.adapter';
import { NamedConsoleChannelAdapter } from './adapters/wave3-console/named-console-channel.adapter';

describe('ChannelAdapterFactory', () => {
  let factory: ChannelAdapterFactory;

  beforeEach(() => {
    factory = new ChannelAdapterFactory(
      { adapterType: 'mock' } as MockChannelAdapter,
      { adapterType: 'booking_com' } as BookingComAdapter,
      { adapterType: 'siteminder' } as SiteMinderAdapter,
      { adapterType: 'expedia' } as ExpediaAdapter,
      { adapterType: 'derbysoft' } as DerbySoftAdapter,
      { adapterType: 'beds24' } as Beds24Adapter,
      { adapterType: 'channex' } as ChannexAdapter,
      [new NamedConsoleChannelAdapter('yieldplanet', 'YieldPlanet')],
    );
  });

  it('registers beds24, channex, and wave3 console adapter types', () => {
    const types = factory.getAvailableAdapterTypes();
    expect(types).toContain('beds24');
    expect(types).toContain('channex');
    expect(types).toContain('yieldplanet');
  });

  it('returns adapters by type', () => {
    expect(factory.getAdapter('beds24').adapterType).toBe('beds24');
    expect(factory.getAdapter('channex').adapterType).toBe('channex');
    expect(factory.getAdapter('yieldplanet').adapterType).toBe('yieldplanet');
  });

  it('throws for unknown adapter type', () => {
    expect(() => factory.getAdapter('unknown_ota')).toThrow(BadRequestException);
  });
});
