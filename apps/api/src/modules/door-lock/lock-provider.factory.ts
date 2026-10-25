import { Inject, Injectable, Logger } from '@nestjs/common';
import { LOCK_PROVIDERS, type LockProvider } from './lock-provider.interface';

/**
 * Selects the active door-lock adapter from env and registered providers.
 *
 * `DOOR_LOCK_PROVIDER` names the adapter (`webhook`, `nuki`, `ttlock`, `salto_ks`, `console`).
 * In production/staging (without HAIP_ALLOW_INSECURE), missing vendors fail closed —
 * no silent console PIN fallback. Dev/test may fall back to console for local demos.
 */
@Injectable()
export class LockProviderFactory {
  private readonly logger = new Logger(LockProviderFactory.name);
  private resolved?: LockProvider;

  constructor(@Inject(LOCK_PROVIDERS) private readonly providers: LockProvider[]) {}

  resolve(): LockProvider {
    if (this.resolved) return this.resolved;
    this.resolved = this.resolveNamed(
      process.env['DOOR_LOCK_PROVIDER']?.trim().toLowerCase() || 'webhook',
    );
    return this.resolved;
  }

  /**
   * Property-scoped preference (settings.onlineCheckIn.lockProvider) with env fallback.
   */
  resolveForProperty(preferred?: string | null): LockProvider {
    const name = (preferred || process.env['DOOR_LOCK_PROVIDER'] || 'webhook')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
    return this.resolveNamed(name);
  }

  /** True when console fallback / explicit console must be refused. */
  private failClosed(): boolean {
    const nodeEnv = process.env['NODE_ENV'];
    const productionLike = nodeEnv === 'production' || nodeEnv === 'staging';
    if (!productionLike) return false;
    return process.env['HAIP_ALLOW_INSECURE'] !== 'true';
  }

  private resolveNamed(requestedRaw: string): LockProvider {
    const requested = requestedRaw.replace(/-/g, '_');
    const byName = new Map(this.providers.map((p) => [p.name, p]));
    const chosen = byName.get(requested);

    if (chosen?.isConfigured()) {
      if (requested === 'console' && this.failClosed()) {
        throw new Error('Console door lock provider is not allowed in production');
      }
      this.logger.log(`Door lock provider: ${chosen.name}`);
      return chosen;
    }

    if (requested === 'console') {
      const consoleProvider = byName.get('console');
      if (!consoleProvider) throw new Error('Console lock provider not registered');
      if (this.failClosed()) {
        throw new Error('Console door lock provider is not allowed in production');
      }
      this.logger.warn('Using console door lock provider (non-production)');
      return consoleProvider;
    }

    if (chosen && !chosen.isConfigured()) {
      this.logger.warn(`Door lock provider "${requested}" is not configured`);
    } else if (!chosen) {
      this.logger.warn(`Unknown door lock provider "${requested}"`);
    }

    if (this.failClosed()) {
      throw new Error(
        `Door lock provider "${requested}" is not configured — refusing console fallback in production`,
      );
    }

    const consoleProvider = byName.get('console');
    if (consoleProvider) {
      this.logger.warn(
        `Falling back to console adapter for "${requested}" (non-production only)`,
      );
      return consoleProvider;
    }

    const webhook = byName.get('webhook');
    if (webhook) return webhook;

    throw new Error('No door lock providers registered');
  }
}
