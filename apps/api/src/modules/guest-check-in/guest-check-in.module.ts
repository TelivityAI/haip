import { Module } from '@nestjs/common';
import { ReservationModule } from '../reservation/reservation.module';
import { PaymentModule } from '../payment/payment.module';
import { FolioModule } from '../folio/folio.module';
import { DoorLockModule } from '../door-lock/door-lock.module';
import { MediaModule } from '../media/media.module';
import { GuestCheckInController } from './guest-check-in.controller';
import { GuestCheckInService } from './guest-check-in.service';
import { CheckInMagicGuard } from './check-in-magic.guard';
import { WalletPassService } from './wallet-pass.service';

@Module({
  imports: [ReservationModule, PaymentModule, FolioModule, DoorLockModule, MediaModule],
  controllers: [GuestCheckInController],
  providers: [GuestCheckInService, CheckInMagicGuard, WalletPassService],
  exports: [GuestCheckInService],
})
export class GuestCheckInModule {}
