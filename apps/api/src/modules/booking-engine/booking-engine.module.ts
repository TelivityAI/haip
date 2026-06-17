import { Module } from '@nestjs/common';
import { BookingEngineController } from './booking-engine.controller';
import { BookingEngineAdminController } from './booking-engine-admin.controller';
import { BookingEngineService } from './booking-engine.service';
import { BookingEngineConfigService } from './booking-engine-config.service';
import { BookingThrottleGuard } from './booking-throttle.guard';
import { BookingKeyGuard } from '../auth/booking-key.guard';
import { BookingEngineScopeGuard } from '../auth/booking-engine-scope.guard';
import { ConnectModule } from '../connect/connect.module';
import { ReservationModule } from '../reservation/reservation.module';
import { RatePlanModule } from '../rate-plan/rate-plan.module';
import { TaxModule } from '../tax/tax.module';
import { GuestModule } from '../guest/guest.module';
import { FolioModule } from '../folio/folio.module';
import { PaymentModule } from '../payment/payment.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ConnectModule, // ConnectSearchService, ConnectBookingService
    ReservationModule, // ReservationService, AvailabilityService
    RatePlanModule,
    TaxModule,
    GuestModule,
    FolioModule,
    PaymentModule,
    AccountingModule, // DepositService
    AuthModule,
  ],
  controllers: [BookingEngineController, BookingEngineAdminController],
  providers: [
    BookingEngineService,
    BookingEngineConfigService,
    BookingKeyGuard,
    BookingEngineScopeGuard,
    BookingThrottleGuard,
  ],
  exports: [BookingEngineConfigService],
})
export class BookingEngineModule {}
