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
import { SerbiaEturistaConsoleProvider } from './providers/serbia-eturista-console.provider';
import { SerbiaSufEsirConsoleProvider } from './providers/serbia-suf-esir-console.provider';

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
    {
      provide: FISCAL_PROVIDERS,
      useFactory: (
        mock: MockFiscalProvider,
        serbia: SerbiaSufEsirConsoleProvider,
      ): FiscalProvider[] => [mock, serbia],
      inject: [MockFiscalProvider, SerbiaSufEsirConsoleProvider],
    },
    {
      provide: GUEST_REGISTRATION_PROVIDERS,
      useFactory: (
        mock: MockGuestRegistrationProvider,
        serbia: SerbiaEturistaConsoleProvider,
      ): GuestRegistrationProvider[] => [mock, serbia],
      inject: [MockGuestRegistrationProvider, SerbiaEturistaConsoleProvider],
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
