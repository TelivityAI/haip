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
import type { BookingComConfig } from './booking-com.config';
import { DEFAULT_BOOKING_COM_CONFIG } from './booking-com.config';
import { buildOtaXml, parseOtaXml } from './booking-com.xml';
import {
  mapAvailabilityToOta,
  mapRatesToOta,
  mapRestrictionsToOta,
  mapOtaReservationToHaip,
  buildReservationConfirmation,
} from './booking-com.mapper';
import {
  validatePhotosForBooking,
  mapMediaToBookingPhotos,
  mapRoomTypeToBookingRoom,
  mapPropertyDescription,
} from './booking-com.content-mapper';

@Injectable()
export class BookingComAdapter implements ChannelAdapter {
  readonly adapterType = 'booking_com';
  private readonly logger = new Logger(BookingComAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  async pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = mapAvailabilityToOta(config.hotelId, params.items);
    const xml = buildOtaXml('OTA_HotelAvailNotifRQ', payload);

    const response = await this.sendRequest(config, 'OTA_HotelAvailNotif', xml);

    if (!response.success) {
      return {
        success: false,
        itemsSynced: 0,
        errors: response.errors.map((e) => ({ item: 'availability', message: `[${e.code}] ${e.message}` })),
      };
    }

    return { success: true, itemsSynced: params.items.length, errors: [] };
  }

  async pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = mapRatesToOta(config.hotelId, params.items);
    const xml = buildOtaXml('OTA_HotelRateAmountNotifRQ', payload);

    const response = await this.sendRequest(config, 'OTA_HotelRateAmountNotif', xml);

    if (!response.success) {
      return {
        success: false,
        itemsSynced: 0,
        errors: response.errors.map((e) => ({ item: 'rates', message: `[${e.code}] ${e.message}` })),
      };
    }

    return { success: true, itemsSynced: params.items.length, errors: [] };
  }

  async pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = mapRestrictionsToOta(config.hotelId, params.items);
    const xml = buildOtaXml('OTA_HotelRateAmountNotifRQ', payload);

    const response = await this.sendRequest(config, 'OTA_HotelRateAmountNotif', xml);

    if (!response.success) {
      return {
        success: false,
        itemsSynced: 0,
        errors: response.errors.map((e) => ({ item: 'restrictions', message: `[${e.code}] ${e.message}` })),
      };
    }

    return { success: true, itemsSynced: params.items.length, errors: [] };
  }

  /**
   * Push descriptive content via Booking.com's JSON REST modules (NOT OTA XML):
   * Photo API for images, Rooms/Property-Description APIs for room/property copy.
   * Photos are submitted to a PENDING queue and processed/moderated async — a
   * successful push means "submitted", not "live".
   */
  async pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const errors: Array<{ item: string; message: string }> = [];
    let itemsSynced = 0;

    // 1) Photos — validate against the real Booking.com limits, then submit the
    //    accepted set to the property pending-photos gallery.
    const allImages = [
      ...params.property.images,
      ...params.roomTypes.flatMap((rt) => rt.images),
    ];
    const { accepted, rejected } = validatePhotosForBooking(allImages);
    for (const r of rejected) errors.push({ item: `photo:${r.url}`, message: r.reason });

    if (accepted.length > 0) {
      const body = mapMediaToBookingPhotos(accepted);
      const res = await this.sendJson(
        config,
        'POST',
        `/properties/${encodeURIComponent(config.hotelId)}/pending/photos`,
        body,
      );
      if (res.ok) itemsSynced += accepted.length;
      else errors.push({ item: 'photos', message: res.error ?? `HTTP ${res.status}` });
    }

    // 2) Property + room descriptions/amenities (Rooms / Property-Description /
    //    Facilities APIs). VERIFY payloads in the certification sandbox.
    const propRes = await this.sendJson(
      config,
      'PUT',
      `/properties/${encodeURIComponent(config.hotelId)}/details`,
      mapPropertyDescription(params.property),
    );
    if (propRes.ok) itemsSynced += 1;
    else errors.push({ item: 'property', message: propRes.error ?? `HTTP ${propRes.status}` });

    for (const rt of params.roomTypes) {
      const roomRes = await this.sendJson(
        config,
        'PUT',
        `/properties/${encodeURIComponent(config.hotelId)}/rooms/${encodeURIComponent(rt.channelRoomCode)}`,
        mapRoomTypeToBookingRoom(rt),
      );
      if (roomRes.ok) itemsSynced += 1;
      else errors.push({ item: `room:${rt.channelRoomCode}`, message: roomRes.error ?? `HTTP ${roomRes.status}` });
    }

    // Submitted to Booking.com; photos remain pending until processed/moderated.
    return { success: errors.length === 0, itemsSynced, errors };
  }

  /**
   * Send a JSON request to a Booking.com REST module with Basic auth + retry.
   */
  private async sendJson(
    config: BookingComConfig,
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; error?: string; data?: unknown }> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const timeoutMs = config.timeoutMs ?? 30_000;
    const maxRetries = config.maxRetries ?? 3;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        if (!res.ok) {
          this.logger.warn(`Booking.com ${method} ${path} HTTP ${res.status} (attempt ${attempt}/${maxRetries})`);
          lastError = new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
          if (attempt < maxRetries) continue;
          return { ok: false, status: res.status, error: lastError.message };
        }
        return { ok: true, status: res.status, data: text ? safeJson(text) : undefined };
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Booking.com ${method} ${path} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
        if (attempt < maxRetries) continue;
      }
    }
    return { ok: false, status: 0, error: lastError?.message ?? 'Unknown error' };
  }

  async pullReservations(params: ReservationPullParams): Promise<ChannelReservationResult> {
    const config = this.resolveConfig(params.connectionConfig);

    const payload: Record<string, unknown> = {
      ReadRequests: {
        HotelReadRequest: {
          '@_HotelCode': config.hotelId,
        },
      },
    };

    // If since is provided, filter by last fetch date
    if (params.since) {
      const readRequests = payload['ReadRequests'] as any;
      readRequests.HotelReadRequest['@_Start'] =
        params.since.toISOString().split('T')[0];
    }

    const xml = buildOtaXml('OTA_HotelResRQ', payload);
    const response = await this.sendRequest(config, 'OTA_HotelResRQ', xml);

    if (!response.success) {
      return {
        success: false,
        reservations: [],
        errors: response.errors.map((e) => ({ externalId: '', message: `[${e.code}] ${e.message}` })),
      };
    }

    try {
      const reservations = mapOtaReservationToHaip(response.data);
      return { success: true, reservations, errors: [] };
    } catch (error: any) {
      this.logger.error(`Failed to parse reservation response: ${error.message}`);
      return {
        success: false,
        reservations: [],
        errors: [{ externalId: '', message: `Parse error: ${error.message}` }],
      };
    }
  }

  async confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = buildReservationConfirmation(
      params.externalConfirmation,
      params.pmsConfirmationNumber,
    );
    const xml = buildOtaXml('OTA_HotelResRS', payload);

    const response = await this.sendRequest(config, 'OTA_HotelResRS', xml);

    return {
      success: response.success,
      itemsSynced: response.success ? 1 : 0,
      errors: response.errors.map((e) => ({ item: params.externalConfirmation, message: `[${e.code}] ${e.message}` })),
    };
  }

  async cancelReservation(params: CancelReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);

    const payload = {
      UniqueID: {
        '@_Type': '14',
        '@_ID': params.externalConfirmation,
      },
      Reasons: params.reason
        ? { Reason: { Text: params.reason } }
        : undefined,
    };

    const xml = buildOtaXml('OTA_CancelRQ', payload);
    const response = await this.sendRequest(config, 'OTA_CancelRQ', xml);

    return {
      success: response.success,
      itemsSynced: response.success ? 1 : 0,
      errors: response.errors.map((e) => ({ item: params.externalConfirmation, message: `[${e.code}] ${e.message}` })),
    };
  }

  async testConnection(config: Record<string, unknown>): Promise<{ connected: boolean; message: string }> {
    try {
      const bcConfig = this.buildConfig(config);
      // Simple availability pull to test connectivity
      const xml = buildOtaXml('OTA_HotelAvailNotifRQ', {
        AvailStatusMessages: {
          '@_HotelCode': bcConfig.hotelId,
        },
      });

      const response = await this.sendRequest(bcConfig, 'OTA_HotelAvailNotif', xml);

      return {
        connected: response.success || response.errors.length === 0,
        message: response.success
          ? `Connected to Booking.com for hotel ${bcConfig.hotelId}`
          : `Connection test failed: ${response.errors.map((e) => e.message).join(', ')}`,
      };
    } catch (error: any) {
      return { connected: false, message: `Connection failed: ${error.message}` };
    }
  }

  // --- Private ---

  /**
   * Send an OTA XML request to the Booking.com API with Basic Auth and retry.
   */
  private async sendRequest(
    config: BookingComConfig,
    endpoint: string,
    xml: string,
  ): Promise<ReturnType<typeof parseOtaXml>> {
    const url = `${config.baseUrl}/${endpoint}`;
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const timeoutMs = config.timeoutMs ?? 30_000;
    const maxRetries = config.maxRetries ?? 3;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml',
            Authorization: `Basic ${auth}`,
          },
          body: xml,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const responseText = await res.text();

        if (!res.ok) {
          this.logger.warn(
            `Booking.com ${endpoint} HTTP ${res.status} (attempt ${attempt}/${maxRetries})`,
          );
          lastError = new Error(`HTTP ${res.status}: ${responseText.substring(0, 200)}`);
          if (attempt < maxRetries) continue;
          break;
        }

        return parseOtaXml(responseText);
      } catch (error: any) {
        lastError = error;
        this.logger.warn(
          `Booking.com ${endpoint} failed (attempt ${attempt}/${maxRetries}): ${error.message}`,
        );
        if (attempt < maxRetries) continue;
      }
    }

    return {
      success: false,
      messageName: 'Error',
      data: {},
      errors: [{ code: 'NETWORK', message: lastError?.message ?? 'Unknown error' }],
    };
  }

  /**
   * Resolve config for a channel connection.
   * Prefers per-connection credentials from channelConnections.config (passed via params.connectionConfig);
   * falls back to env vars only when a value is missing from the connection record.
   */
  private resolveConfig(connectionConfig?: Record<string, unknown>): BookingComConfig {
    return this.buildConfig(connectionConfig ?? {});
  }

  private buildConfig(config: Record<string, unknown>): BookingComConfig {
    const hotelId = config['hotelId'];
    const username = config['username'];
    const password = config['password'];
    const baseUrl = config['baseUrl'];
    return {
      hotelId: hotelId != null && hotelId !== ''
        ? String(hotelId)
        : this.configService.get<string>('BOOKING_COM_HOTEL_ID', 'MOCK_HOTEL_1'),
      username: username != null && username !== ''
        ? String(username)
        : this.configService.get<string>('BOOKING_COM_USERNAME', 'haip_test'),
      password: password != null && password !== ''
        ? String(password)
        : this.configService.get<string>('BOOKING_COM_PASSWORD', 'test_password'),
      baseUrl: baseUrl != null && baseUrl !== ''
        ? String(baseUrl)
        : this.configService.get<string>('BOOKING_COM_BASE_URL', DEFAULT_BOOKING_COM_CONFIG.baseUrl!),
      timeoutMs: DEFAULT_BOOKING_COM_CONFIG.timeoutMs,
      maxRetries: DEFAULT_BOOKING_COM_CONFIG.maxRetries,
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
