import { Injectable, BadRequestException, Inject, Optional } from '@nestjs/common';
import type { ChannelAdapter } from './channel-adapter.interface';
import { MockChannelAdapter } from './adapters/mock.adapter';
import { BookingComAdapter } from './adapters/booking-com/booking-com.adapter';
import { SiteMinderAdapter } from './adapters/siteminder/siteminder.adapter';
import { ExpediaAdapter } from './adapters/expedia/expedia.adapter';
import { DerbySoftAdapter } from './adapters/derbysoft/derbysoft.adapter';
import { Beds24Adapter } from './adapters/beds24/beds24.adapter';
import { ChannexAdapter } from './adapters/channex/channex.adapter';
import {
  WAVE_CHANNEL_ADAPTERS,
  type NamedConsoleChannelAdapter,
} from './adapters/wave3-console/named-console-channel.adapter';

/**
 * Factory that maps adapterType strings to ChannelAdapter instances.
 */
@Injectable()
export class ChannelAdapterFactory {
  private adapters: Map<string, ChannelAdapter> = new Map();

  constructor(
    private readonly mockAdapter: MockChannelAdapter,
    private readonly bookingComAdapter: BookingComAdapter,
    private readonly siteMinderAdapter: SiteMinderAdapter,
    private readonly expediaAdapter: ExpediaAdapter,
    private readonly derbySoftAdapter: DerbySoftAdapter,
    private readonly beds24Adapter: Beds24Adapter,
    private readonly channexAdapter: ChannexAdapter,
    @Optional()
    @Inject(WAVE_CHANNEL_ADAPTERS)
    waveAdapters: NamedConsoleChannelAdapter[] | null = null,
  ) {
    this.adapters.set('mock', this.mockAdapter);
    this.adapters.set('booking_com', this.bookingComAdapter);
    this.adapters.set('siteminder', this.siteMinderAdapter);
    this.adapters.set('expedia', this.expediaAdapter);
    this.adapters.set('derbysoft', this.derbySoftAdapter);
    this.adapters.set('beds24', this.beds24Adapter);
    this.adapters.set('channex', this.channexAdapter);
    for (const adapter of waveAdapters ?? []) {
      this.adapters.set(adapter.adapterType, adapter);
    }
  }

  getAdapter(adapterType: string): ChannelAdapter {
    const adapter = this.adapters.get(adapterType);
    if (!adapter) {
      throw new BadRequestException(
        `Unknown channel adapter type: '${adapterType}'. Available: ${[...this.adapters.keys()].join(', ')}`,
      );
    }
    return adapter;
  }

  getAvailableAdapterTypes(): string[] {
    return [...this.adapters.keys()];
  }
}
