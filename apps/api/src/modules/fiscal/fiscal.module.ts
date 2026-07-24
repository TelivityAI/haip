import { Module } from '@nestjs/common';
import { FolioModule } from '../folio/folio.module';
import { FiscalController } from './fiscal.controller';
import { FiscalListener } from './fiscal.listener';
import { FiscalProviderFactory } from './fiscal-provider.factory';
import {
  FISCAL_PROVIDERS,
  type FiscalProvider,
} from './fiscal-provider.interface';
import { FiscalService } from './fiscal.service';
import {
  GUEST_REGISTRATION_PROVIDERS,
  type GuestRegistrationProvider,
} from './guest-registration-provider.interface';
import { MockFiscalProvider } from './providers/mock-fiscal.provider';
import { MockGuestRegistrationProvider } from './providers/mock-guest-registration.provider';
import {
  NamedConsoleFiscalProvider,
  WAVE_FISCAL_CONSOLE_PACKS,
} from './providers/named-console-fiscal.provider';
import {
  NamedConsoleGuestRegistrationProvider,
  WAVE_GUEST_REG_CONSOLE_PACKS,
} from './providers/named-console-guest-registration.provider';
import { SerbiaEturistaConsoleProvider } from './providers/serbia-eturista-console.provider';
import { SerbiaSufEsirConsoleProvider } from './providers/serbia-suf-esir-console.provider';

const WAVE_FISCAL_PROVIDER_TOKENS = WAVE_FISCAL_CONSOLE_PACKS.map(
  (pack) => `FISCAL_CONSOLE_${pack.key.toUpperCase()}`,
);

const WAVE_GUEST_REG_PROVIDER_TOKENS = WAVE_GUEST_REG_CONSOLE_PACKS.map(
  (pack) => `GUEST_REG_CONSOLE_${pack.key.toUpperCase()}`,
);

const waveFiscalProviders = WAVE_FISCAL_CONSOLE_PACKS.map((pack, index) => ({
  provide: WAVE_FISCAL_PROVIDER_TOKENS[index],
  useFactory: () => new NamedConsoleFiscalProvider(pack.key, pack.label),
}));

const waveGuestRegProviders = WAVE_GUEST_REG_CONSOLE_PACKS.map((pack, index) => ({
  provide: WAVE_GUEST_REG_PROVIDER_TOKENS[index],
  useFactory: () => new NamedConsoleGuestRegistrationProvider(pack.key, pack.label),
}));

@Module({
  imports: [FolioModule],
  controllers: [FiscalController],
  providers: [
    FiscalService,
    FiscalListener,
    FiscalProviderFactory,
    MockFiscalProvider,
    MockGuestRegistrationProvider,
    SerbiaSufEsirConsoleProvider,
    SerbiaEturistaConsoleProvider,
    ...waveFiscalProviders,
    ...waveGuestRegProviders,
    {
      provide: FISCAL_PROVIDERS,
      useFactory: (
        mock: MockFiscalProvider,
        serbia: SerbiaSufEsirConsoleProvider,
        ...wave: NamedConsoleFiscalProvider[]
      ): FiscalProvider[] => [mock, serbia, ...wave],
      inject: [
        MockFiscalProvider,
        SerbiaSufEsirConsoleProvider,
        ...WAVE_FISCAL_PROVIDER_TOKENS,
      ],
    },
    {
      provide: GUEST_REGISTRATION_PROVIDERS,
      useFactory: (
        mock: MockGuestRegistrationProvider,
        serbia: SerbiaEturistaConsoleProvider,
        ...wave: NamedConsoleGuestRegistrationProvider[]
      ): GuestRegistrationProvider[] => [mock, serbia, ...wave],
      inject: [
        MockGuestRegistrationProvider,
        SerbiaEturistaConsoleProvider,
        ...WAVE_GUEST_REG_PROVIDER_TOKENS,
      ],
    },
  ],
  exports: [
    FiscalService,
    FiscalProviderFactory,
    FISCAL_PROVIDERS,
    GUEST_REGISTRATION_PROVIDERS,
  ],
})
export class FiscalModule {}
