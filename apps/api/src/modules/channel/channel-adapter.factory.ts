import { Injectable, BadRequestException } from '@nestjs/common';
import type { ChannelAdapter } from './channel-adapter.interface';
import { MockChannelAdapter } from './adapters/mock.adapter';
// Import directly from the adapter files (not the barrel index) to avoid a
// circular import: barrel re-exports BookingComInboundController, which
// imports InboundReservationService, which imports ChannelAdapterFactory.
import { BookingComAdapter } from './adapters/booking-com/booking-com.adapter';
import { SiteMinderAdapter } from './adapters/siteminder/siteminder.adapter';
import { ExpediaAdapter } from './adapters/expedia/expedia.adapter';
import { DerbySoftAdapter } from './adapters/derbysoft/derbysoft.adapter';
import { Beds24Adapter } from './adapters/beds24/beds24.adapter';
import { ChannexAdapter } from './adapters/channex/channex.adapter';

/**
 * Factory that maps adapterType strings to ChannelAdapter instances.
 * Adding a real adapter (SiteMinder, Expedia, DerbySoft, Beds24, Channex) = register here.
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
  ) {
    this.adapters.set('mock', this.mockAdapter);
    this.adapters.set('booking_com', this.bookingComAdapter);
    this.adapters.set('siteminder', this.siteMinderAdapter);
    this.adapters.set('expedia', this.expediaAdapter);
    this.adapters.set('derbysoft', this.derbySoftAdapter);
    this.adapters.set('beds24', this.beds24Adapter);
    this.adapters.set('channex', this.channexAdapter);
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
