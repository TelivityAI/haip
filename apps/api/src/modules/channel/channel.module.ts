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
import { ReservationModule } from '../reservation/reservation.module';
import { WebhookModule } from '../webhook/webhook.module';
import { MediaModule } from '../media/media.module';

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
  ],
  exports: [ChannelService, AriService, InboundReservationService],
})
export class ChannelModule {}
