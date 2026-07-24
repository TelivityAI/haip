import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { RateLimitGuard } from './common/security/rate-limit.guard';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { PropertyModule } from './modules/property/property.module';
import { RoomModule } from './modules/room/room.module';
import { GuestModule } from './modules/guest/guest.module';
import { MediaModule } from './modules/media/media.module';
import { ReservationModule } from './modules/reservation/reservation.module';
import { FolioModule } from './modules/folio/folio.module';
import { RatePlanModule } from './modules/rate-plan/rate-plan.module';
import { PaymentModule } from './modules/payment/payment.module';
import { HousekeepingModule } from './modules/housekeeping/housekeeping.module';
import { LostAndFoundModule } from './modules/lost-and-found/lost-and-found.module';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module';
import { NightAuditModule } from './modules/night-audit/night-audit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { ChannelModule } from './modules/channel/channel.module';
import { ConnectModule } from './modules/connect/connect.module';
import { EventsModule } from './modules/events/events.module';
import { TaxModule } from './modules/tax/tax.module';
import { AuthModule } from './modules/auth/auth.module';
import { AgentModule } from './modules/agent/agent.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { CashierModule } from './modules/cashier/cashier.module';
import { HouseAccountModule } from './modules/house-account/house-account.module';
import { AncillaryModule } from './modules/ancillary/ancillary.module';
import { PolicyModule } from './modules/policy/policy.module';
import { GroupsModule } from './modules/groups/groups.module';
import { AdminModule } from './modules/admin/admin.module';
import { BookingEngineModule } from './modules/booking-engine/booking-engine.module';
import { ImportModule } from './modules/import/import.module';
import { AccountingExportModule } from './modules/accounting-export/accounting-export.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { PosModule } from './modules/pos/pos.module';
import { DoorLockModule } from './modules/door-lock/door-lock.module';
import { LlmModule } from './modules/llm/llm.module';
import { SearchModule } from './modules/search/search.module';
import { StaffNotificationsModule } from './modules/staff-notifications/staff-notifications.module';
import { HelpModule } from './modules/help/help.module';
import { FolioInboundModule } from './modules/folio-inbound/folio-inbound.module';
import { TurnawaysModule } from './modules/turnaways/turnaways.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { IcalModule } from './modules/ical/ical.module';

const imports: any[] = [
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: ['.env.local', '.env'],
  }),
  EventEmitterModule.forRoot(),
  DatabaseModule,
  HealthModule,
  PropertyModule,
  RoomModule,
  GuestModule,
  MediaModule,
  ReservationModule,
  FolioModule,
  RatePlanModule,
  PaymentModule,
  HousekeepingModule,
  LostAndFoundModule,
  ServiceRequestsModule,
  NightAuditModule,
  ReportsModule,
  WebhookModule,
  ChannelModule,
  ConnectModule,
  EventsModule,
  TaxModule,
  AuthModule,
  AgentModule,
  AccountingModule,
  CashierModule,
  HouseAccountModule,
  AncillaryModule,
  PolicyModule,
  GroupsModule,
  AdminModule,
  BookingEngineModule,
  ImportModule,
  AccountingExportModule,
  NotificationsModule,
  ReviewsModule,
  PosModule,
  FolioInboundModule,
  DoorLockModule,
  LlmModule,
  SearchModule,
  StaffNotificationsModule,
  HelpModule,
  TurnawaysModule,
  WaitlistModule,
  LoyaltyModule,
  IcalModule,
];

// Serve the bundled dashboard as static files. Enabled in production, or
// whenever SERVE_DASHBOARD=true — so the one-command demo can serve the UI at
// the same origin as the API while keeping NODE_ENV=development (Swagger, etc.).
if (process.env['NODE_ENV'] === 'production' || process.env['SERVE_DASHBOARD'] === 'true') {
  imports.push(
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'dashboard', 'dist'),
      // @nestjs/serve-static v5 defaults to `{*any}`, which Express 4 treats
      // as a literal route rather than an SPA catch-all.
      renderPath: '*',
      exclude: ['/api{/*path}', '/booking{/*path}'],
    }),
  );
}

if (process.env['NODE_ENV'] === 'production' || process.env['SERVE_BOOKING'] === 'true') {
  imports.push(
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'booking', 'dist'),
      serveRoot: '/booking',
      renderPath: '*',
      exclude: ['/api{/*path}'],
    }),
  );
}

@Module({
  imports,
  providers: [
    // Global, in-memory brute-force mitigation (interim, pre-C2). Runs first.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
