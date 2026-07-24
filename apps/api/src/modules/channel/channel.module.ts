import { Module } from '@nestjs/common';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { AriService } from './ari.service';
import { ContentSyncService } from './content-sync.service';
import { InboundReservationService } from './inbound-reservation.service';
import { RateParityService } from './rate-parity.service';
import { ChannelAdapterFactory } from './channel-adapter.factory';
import { MockChannelAdapter } from './adapters/mock.adapter';
// Import adapters directly from their files (not the barrel index) to avoid a
// circular import loop through the inbound controller.
import { BookingComAdapter } from './adapters/booking-com/booking-com.adapter';
import { BookingComInboundController } from './adapters/booking-com/booking-com-inbound.controller';
import { SiteMinderAdapter } from './adapters/siteminder/siteminder.adapter';
import { ExpediaAdapter } from './adapters/expedia/expedia.adapter';
import { ExpediaInboundController } from './adapters/expedia/expedia-inbound.controller';
import { DerbySoftAdapter } from './adapters/derbysoft/derbysoft.adapter';
import { DerbySoftInboundController } from './adapters/derbysoft/derbysoft-inbound.controller';
import { Beds24Adapter } from './adapters/beds24/beds24.adapter';
import { ChannexAdapter } from './adapters/channex/channex.adapter';
import {
  NamedConsoleChannelAdapter,
  WAVE_CHANNEL_ADAPTERS,
  WAVE_CHANNEL_CONSOLE_PACKS,
} from './adapters/wave3-console/named-console-channel.adapter';
import { ReservationModule } from '../reservation/reservation.module';
import { WebhookModule } from '../webhook/webhook.module';
import { MediaModule } from '../media/media.module';

const WAVE_CHANNEL_TOKENS = WAVE_CHANNEL_CONSOLE_PACKS.map(
  (pack) => `WAVE_CHANNEL_${pack.key.toUpperCase()}`,
);

const waveChannelProviders = WAVE_CHANNEL_CONSOLE_PACKS.map((pack, index) => ({
  provide: WAVE_CHANNEL_TOKENS[index]!,
  useFactory: () => new NamedConsoleChannelAdapter(pack.key, pack.label),
}));

@Module({
  imports: [ReservationModule, WebhookModule, MediaModule],
  controllers: [
    ChannelController,
    BookingComInboundController,
    ExpediaInboundController,
    DerbySoftInboundController,
  ],
  providers: [
    ChannelService,
    AriService,
    ContentSyncService,
    InboundReservationService,
    RateParityService,
    ChannelAdapterFactory,
    MockChannelAdapter,
    BookingComAdapter,
    SiteMinderAdapter,
    ExpediaAdapter,
    DerbySoftAdapter,
    Beds24Adapter,
    ChannexAdapter,
    ...waveChannelProviders,
    {
      provide: WAVE_CHANNEL_ADAPTERS,
      useFactory: (...wave: NamedConsoleChannelAdapter[]) => wave,
      inject: [...WAVE_CHANNEL_TOKENS],
    },
  ],
  exports: [ChannelService, AriService, InboundReservationService],
})
export class ChannelModule {}
