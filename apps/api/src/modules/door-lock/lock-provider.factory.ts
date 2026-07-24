import { Inject, Injectable, Logger } from '@nestjs/common';
import { LOCK_PROVIDERS, type LockProvider } from './lock-provider.interface';

/**
 * Selects the active door-lock adapter from env and registered providers.
 *
 * `DOOR_LOCK_PROVIDER` names the adapter (`webhook`, `nuki`, `ttlock`, `salto_ks`, `console`).
 * When the requested vendor is not configured, falls back to `console` (logged-only PIN).
 */
@Injectable()
export class LockProviderFactory {
  private readonly logger = new Logger(LockProviderFactory.name);
  private resolved?: LockProvider;

  constructor(@Inject(LOCK_PROVIDERS) private readonly providers: LockProvider[]) {}

  resolve(): LockProvider {
    if (this.resolved) return this.resolved;

    const requested = (process.env['DOOR_LOCK_PROVIDER']?.trim().toLowerCase() || 'webhook').replace(
      /-/g,
      '_',
    );
    const byName = new Map(this.providers.map((p) => [p.name, p]));
    const chosen = byName.get(requested);

    if (chosen?.isConfigured()) {
      this.resolved = chosen;
      this.logger.log(`Door lock provider: ${chosen.name}`);
      return chosen;
    }

    if (chosen && !chosen.isConfigured()) {
      this.logger.warn(
        `Door lock provider "${requested}" is not configured — falling back to console adapter`,
      );
    } else if (!chosen) {
      this.logger.warn(`Unknown DOOR_LOCK_PROVIDER "${requested}" — falling back to console adapter`);
    }

    const consoleProvider = byName.get('console');
    if (consoleProvider) {
      this.resolved = consoleProvider;
      return consoleProvider;
    }

    const webhook = byName.get('webhook');
    if (webhook) {
      this.resolved = webhook;
      return webhook;
    }

    throw new Error('No door lock providers registered');
  }
}
