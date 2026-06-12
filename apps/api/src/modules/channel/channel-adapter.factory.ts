import { Injectable, BadRequestException } from '@nestjs/common';
import type { ChannelAdapter } from './channel-adapter.interface';
import { MockChannelAdapter } from './adapters/mock.adapter';
// Import directly from the adapter files (not the barrel index) to avoid a
// circular import: barrel re-exports BookingComInboundController, which
// imports InboundReservationService, which imports ChannelAdapterFactory.
import { BookingComAdapter } from './adapters/booking-com/booking-com.adapter';
import { SiteMinderAdapter } from './adapters/siteminder/siteminder.adapter';
import { ExpediaAdapter } from './adapters/expedia/expedia.adapter';

/**
 * Factory that maps adapterType strings to ChannelAdapter instances.
 * Adding a real adapter (SiteMinder, Expedia, DerbySoft) = register here.
 */
@Injectable()
export class ChannelAdapterFactory {
  private adapters: Map<string, ChannelAdapter> = new Map();

  constructor(
    private readonly mockAdapter: MockChannelAdapter,
    private readonly bookingComAdapter: BookingComAdapter,
    private readonly siteMinderAdapter: SiteMinderAdapter,
    private readonly expediaAdapter: ExpediaAdapter,
  ) {
    this.adapters.set('mock', this.mockAdapter);
    this.adapters.set('booking_com', this.bookingComAdapter);
    this.adapters.set('siteminder', this.siteMinderAdapter);
    this.adapters.set('expedia', this.expediaAdapter);
    // Future: this.adapters.set('derbysoft', this.derbysoftAdapter);
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
