import { Injectable, Logger } from '@nestjs/common';
import type {
  ChannelAdapter,
  AvailabilityPushParams,
  RatePushParams,
  RestrictionPushParams,
  ContentPushParams,
  ReservationPullParams,
  ConfirmReservationParams,
  CancelReservationParams,
  ChannelSyncResult,
  ChannelReservationResult,
} from '../../channel-adapter.interface';
import { createConsoleChannelStub } from '../console-channel.stub';

/**
 * Wave 3 channel-manager console adapters.
 * Partner HTTP clients replace these when credentials + certs exist.
 */
@Injectable()
export class NamedConsoleChannelAdapter implements ChannelAdapter {
  readonly adapterType: string;
  private readonly stub: ReturnType<typeof createConsoleChannelStub>;

  constructor(adapterType: string, label: string) {
    this.adapterType = adapterType;
    this.stub = createConsoleChannelStub(label);
    new Logger(`ChannelConsole:${adapterType}`).log(
      `${label} console channel adapter registered (no vendor HTTP until credentials)`,
    );
  }

  pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    return this.stub.pushAvailability(params);
  }
  pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    return this.stub.pushRates(params);
  }
  pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    return this.stub.pushRestrictions(params);
  }
  pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    return this.stub.pushContent(params);
  }
  pullReservations(params: ReservationPullParams): Promise<ChannelReservationResult> {
    return this.stub.pullReservations(params);
  }
  confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    return this.stub.confirmReservation(params);
  }
  cancelReservation(params: CancelReservationParams): Promise<ChannelSyncResult> {
    return this.stub.cancelReservation(params);
  }
  testConnection(): Promise<{ connected: boolean; message: string }> {
    return this.stub.testConnection();
  }
}

/** Real CM partner targets (meta cert-queue rows excluded). */
export const WAVE_CHANNEL_CONSOLE_PACKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'expedia_eqc', label: 'Expedia EQC' },
  { key: 'myallocator_cloudbeds', label: 'Myallocator/Cloudbeds' },
  { key: 'atomize', label: 'Atomize' },
  { key: 'yieldplanet', label: 'YieldPlanet' },
  { key: 'd_edge', label: 'D-EDGE' },
  { key: 'cubilis_lighthouse', label: 'Cubilis/Lighthouse' },
  { key: 'rategain', label: 'RateGain' },
  { key: 'hotelrunner', label: 'HotelRunner' },
  { key: 'nextpax', label: 'NextPax' },
  { key: 'hotelbeds', label: 'Hotelbeds API Suite' },
  { key: 'amadeus_hotel', label: 'Amadeus Self-Service Hotel APIs' },
];

export const WAVE_CHANNEL_ADAPTERS = Symbol('WAVE_CHANNEL_ADAPTERS');
