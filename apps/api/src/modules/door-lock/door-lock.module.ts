import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { LOCK_PROVIDER } from './lock-provider.interface';
import { WebhookLockProvider } from './providers/webhook-lock.provider';
import { DoorLockListener } from './door-lock.listener';

/**
 * Wires the default (webhook) lock provider to the LOCK_PROVIDER token. To use a
 * vendor SDK instead, rebind this provider — the listener depends only on the
 * LockProvider interface.
 */
@Module({
  imports: [WebhookModule],
  providers: [
    WebhookLockProvider,
    { provide: LOCK_PROVIDER, useExisting: WebhookLockProvider },
    DoorLockListener,
  ],
  exports: [LOCK_PROVIDER],
})
export class DoorLockModule {}
