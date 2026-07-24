import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { LOCK_PROVIDER, LOCK_PROVIDERS } from './lock-provider.interface';
import { WebhookLockProvider } from './providers/webhook-lock.provider';
import { ConsoleLockProvider } from './providers/console-lock.provider';
import { NukiLockProvider } from './providers/nuki-lock.provider';
import { TtlockLockProvider } from './providers/ttlock-lock.provider';
import { SaltoKsLockProvider } from './providers/salto-ks-lock.provider';
import { LockProviderFactory } from './lock-provider.factory';
import { DoorLockListener } from './door-lock.listener';
import { DoorLockCredentialService } from './door-lock-credential.service';
import { DoorLockService } from './door-lock.service';
import { DoorLockController } from './door-lock.controller';

/**
 * Registers webhook, vendor (Nuki / TTLock / Salto KS), and console lock adapters.
 * {@link LockProviderFactory} binds the active adapter to {@link LOCK_PROVIDER} via
 * `DOOR_LOCK_PROVIDER` (default: webhook).
 */
@Module({
  imports: [WebhookModule],
  controllers: [DoorLockController],
  providers: [
    DoorLockCredentialService,
    DoorLockService,
    WebhookLockProvider,
    ConsoleLockProvider,
    NukiLockProvider,
    TtlockLockProvider,
    SaltoKsLockProvider,
    LockProviderFactory,
    {
      provide: LOCK_PROVIDERS,
      inject: [
        WebhookLockProvider,
        ConsoleLockProvider,
        NukiLockProvider,
        TtlockLockProvider,
        SaltoKsLockProvider,
      ],
      useFactory: (
        webhook: WebhookLockProvider,
        consoleProvider: ConsoleLockProvider,
        nuki: NukiLockProvider,
        ttlock: TtlockLockProvider,
        saltoKs: SaltoKsLockProvider,
      ) => [webhook, consoleProvider, nuki, ttlock, saltoKs],
    },
    {
      provide: LOCK_PROVIDER,
      inject: [LockProviderFactory],
      useFactory: (factory: LockProviderFactory) => factory.resolve(),
    },
    DoorLockListener,
  ],
  exports: [LOCK_PROVIDER, DoorLockCredentialService],
})
export class DoorLockModule {}
