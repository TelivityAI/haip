import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { PropertyModule } from './modules/property/property.module';
import { RoomModule } from './modules/room/room.module';
import { GuestModule } from './modules/guest/guest.module';
import { ReservationModule } from './modules/reservation/reservation.module';
import { FolioModule } from './modules/folio/folio.module';
import { RatePlanModule } from './modules/rate-plan/rate-plan.module';
import { PaymentModule } from './modules/payment/payment.module';
import { HousekeepingModule } from './modules/housekeeping/housekeeping.module';
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
import { GroupsModule } from './modules/groups/groups.module';

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
  ReservationModule,
  FolioModule,
  RatePlanModule,
  PaymentModule,
  HousekeepingModule,
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
  GroupsModule,
];

// Serve dashboard static files in production
if (process.env['NODE_ENV'] === 'production') {
  imports.push(
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'dashboard', 'dist'),
      exclude: ['/api/(.*)'],
    }),
  );
}

@Module({ imports })
export class AppModule {}
