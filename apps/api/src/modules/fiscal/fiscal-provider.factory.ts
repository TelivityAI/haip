import { Inject, Injectable } from '@nestjs/common';
import {
  FISCAL_PROVIDERS,
  type FiscalProvider,
} from './fiscal-provider.interface';
import {
  GUEST_REGISTRATION_PROVIDERS,
  type GuestRegistrationProvider,
} from './guest-registration-provider.interface';

@Injectable()
export class FiscalProviderFactory {
  constructor(
    @Inject(FISCAL_PROVIDERS)
    private readonly fiscalProviders: FiscalProvider[],
    @Inject(GUEST_REGISTRATION_PROVIDERS)
    private readonly guestRegistrationProviders: GuestRegistrationProvider[],
  ) {}

  getFiscalProvider(providerKey?: string | null): FiscalProvider | undefined {
    if (!providerKey) return undefined;
    return this.fiscalProviders.find((provider) => provider.key === providerKey);
  }

  getGuestRegistrationProvider(
    providerKey?: string | null,
  ): GuestRegistrationProvider | undefined {
    if (!providerKey) return undefined;
    return this.guestRegistrationProviders.find((provider) => provider.key === providerKey);
  }

  fiscalProviderKeys(): string[] {
    return this.fiscalProviders.map((provider) => provider.key);
  }

  guestRegistrationProviderKeys(): string[] {
    return this.guestRegistrationProviders.map((provider) => provider.key);
  }
}
