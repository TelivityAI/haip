import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { channelJsonRequest, type ChannelFetchFn } from '../channel-http.util';
import { DEFAULT_BEDS24_CONFIG, type Beds24Config } from './beds24.config';
import {
  buildGetBookingsBody,
  mapAvailabilityToBeds24RoomDates,
  mapBeds24BookingToHaip,
  mapRatesToBeds24RoomDates,
  mapRestrictionsToBeds24RoomDates,
} from './beds24.mapper';

type ConsoleStub = ReturnType<typeof createConsoleChannelStub>;

/**
 * Beds24 channel manager — ARI via JSON setRoomDates, bookings via getBookings.
 *
 * Env: BEDS24_API_KEY, BEDS24_PROP_KEY, optional BEDS24_BASE_URL.
 */
@Injectable()
export class Beds24Adapter implements ChannelAdapter {
  readonly adapterType = 'beds24';
  private readonly logger = new Logger(Beds24Adapter.name);
  private readonly consoleStub: ConsoleStub;
  private readonly fetchFn: ChannelFetchFn;

  constructor(
    private readonly configService: ConfigService,
    deps?: { fetchFn?: ChannelFetchFn },
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    this.consoleStub = createConsoleChannelStub('Beds24');
  }

  private resolveConfig(connectionConfig?: Record<string, unknown>): Beds24Config | null {
    const apiKey =
      (connectionConfig?.['apiKey'] as string | undefined)?.trim() ||
      this.configService.get<string>('BEDS24_API_KEY')?.trim();
    const propKey =
      (connectionConfig?.['propKey'] as string | undefined)?.trim() ||
      (connectionConfig?.['hotelId'] as string | undefined)?.trim() ||
      this.configService.get<string>('BEDS24_PROP_KEY')?.trim();
    if (!apiKey || !propKey) return null;

    const baseUrl = (
      (connectionConfig?.['baseUrl'] as string | undefined) ||
      this.configService.get<string>('BEDS24_BASE_URL', DEFAULT_BEDS24_CONFIG.baseUrl)
    ).replace(/\/$/, '');

    return { apiKey, propKey, baseUrl, timeoutMs: DEFAULT_BEDS24_CONFIG.timeoutMs };
  }

  private auth(config: Beds24Config) {
    return { apiKey: config.apiKey, propKey: config.propKey };
  }

  private async postJson(
    config: Beds24Config,
    path: string,
    body: Record<string, unknown>,
  ): Promise<ChannelSyncResult> {
    const url = `${config.baseUrl}/${path}`;
    const res = await channelJsonRequest(
      url,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        itemsSynced: 0,
        errors: [{ item: path, message: res.errorMessage ?? 'Request failed' }],
      };
    }
    return { success: true, itemsSynced: 1, errors: [] };
  }

  private async pushRoomDateMaps(
    config: Beds24Config,
    roomMaps: Map<string, Record<string, Record<string, string>>>,
    label: string,
  ): Promise<ChannelSyncResult> {
    if (roomMaps.size === 0) {
      return { success: true, itemsSynced: 0, errors: [] };
    }

    const errors: Array<{ item: string; message: string }> = [];
    let itemsSynced = 0;

    for (const [roomId, dates] of roomMaps) {
      const body = {
        authentication: this.auth(config),
        roomId,
        dates,
      };
      const result = await this.postJson(config, 'setRoomDates', body);
      if (result.success) {
        itemsSynced += Object.keys(dates).length;
      } else {
        errors.push(...result.errors.map((e) => ({ item: `${label}:${roomId}`, message: e.message })));
      }
    }

    if (itemsSynced > 0) {
      this.logger.log(`Beds24 setRoomDates (${label}): ${itemsSynced} date(s)`);
    }

    return { success: errors.length === 0, itemsSynced, errors };
  }

  async pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushAvailability(params);
    const maps = mapAvailabilityToBeds24RoomDates(params.items);
    return this.pushRoomDateMaps(config, maps, 'availability');
  }

  async pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushRates(params);
    const maps = mapRatesToBeds24RoomDates(params.items);
    return this.pushRoomDateMaps(config, maps, 'rates');
  }

  async pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushRestrictions(params);
    const maps = mapRestrictionsToBeds24RoomDates(params.items);
    return this.pushRoomDateMaps(config, maps, 'restrictions');
  }

  async pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushContent(params);
    this.logger.log(`Beds24 pushContent skipped (manage in Beds24): ${params.property.name}`);
    return { success: true, itemsSynced: 0, errors: [] };
  }

  async pullReservations(params: ReservationPullParams): Promise<ChannelReservationResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pullReservations(params);

    const body = buildGetBookingsBody(this.auth(config), params.since);
    const url = `${config.baseUrl}/getBookings`;
    const res = await channelJsonRequest<{ data?: Array<Record<string, unknown>> }>(
      url,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        reservations: [],
        errors: [{ externalId: '', message: res.errorMessage ?? 'getBookings failed' }],
      };
    }

    const raw = res.data;
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray((raw as { bookings?: unknown[] })?.bookings)
          ? ((raw as { bookings: Array<Record<string, unknown>> }).bookings ?? [])
          : [];

    const reservations = list
      .map((row) => mapBeds24BookingToHaip(row, config.propKey))
      .filter((r): r is NonNullable<typeof r> => r != null);

    return { success: true, reservations, errors: [] };
  }

  async confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.confirmReservation(params);
    this.logger.log(
      `Beds24 confirmReservation (PMS ref ${params.pmsConfirmationNumber}): ${params.externalConfirmation}`,
    );
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async cancelReservation(params: CancelReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.cancelReservation(params);
    this.logger.log(`Beds24 cancelReservation: ${params.externalConfirmation}`);
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<{ connected: boolean; message: string }> {
    const resolved = this.resolveConfig(config);
    if (!resolved) return this.consoleStub.testConnection();

    const body = buildGetBookingsBody(this.auth(resolved));
    const url = `${resolved.baseUrl}/getBookings`;
    const res = await channelJsonRequest(
      url,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(resolved.timeoutMs ?? 30_000),
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return { connected: false, message: res.errorMessage ?? 'Connection test failed' };
    }
    return { connected: true, message: 'Beds24 getBookings reachable' };
  }
}
