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
import {
  ExpediaConfig,
  DEFAULT_EXPEDIA_CONFIG,
  EXPEDIA_AR_NS,
  EXPEDIA_BC_NS,
} from './expedia.config';
import { assertSafeChannelEndpoint } from '../../../../common/security/url-guard';
import { buildExpediaXml, parseExpediaResponse } from './expedia.xml';
import {
  mapAvailabilityToExpedia,
  mapRatesToExpedia,
  mapRestrictionsToExpedia,
} from './expedia.ar-mapper';
import {
  validateImagesForExpedia,
  mapMediaToExpediaImages,
  mapPropertyForExpedia,
} from './expedia.content-mapper';
import { buildBookingConfirmation } from './expedia.reservation-mapper';

/**
 * Expedia Group adapter (EQC AR for ARI, Booking Notification/Confirmation for
 * reservations, Image + Property APIs for content). Inbound bookings arrive by
 * PUSH at ExpediaInboundController, not by polling.
 */
@Injectable()
export class ExpediaAdapter implements ChannelAdapter {
  readonly adapterType = 'expedia';
  private readonly logger = new Logger(ExpediaAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  async pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const body = mapAvailabilityToExpedia(config.hotelId, config.username, config.password, params.items);
    return this.sendAr(config, body, params.items.length, 'availability');
  }

  async pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const body = mapRatesToExpedia(config.hotelId, config.username, config.password, params.items);
    return this.sendAr(config, body, params.items.length, 'rates');
  }

  async pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const body = mapRestrictionsToExpedia(config.hotelId, config.username, config.password, params.items);
    return this.sendAr(config, body, params.items.length, 'restrictions');
  }

  /** Content = Image API (photos) + Property API (descriptions). */
  async pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const errors: Array<{ item: string; message: string }> = [];
    let itemsSynced = 0;

    const allImages = [...params.property.images, ...params.roomTypes.flatMap((rt) => rt.images)];
    const { accepted, rejected } = validateImagesForExpedia(allImages);
    for (const r of rejected) errors.push({ item: `photo:${r.url}`, message: r.reason });

    if (accepted.length > 0) {
      const res = await this.sendJson(
        config,
        'POST',
        `/properties/${encodeURIComponent(config.hotelId)}/images`,
        mapMediaToExpediaImages(accepted),
      );
      if (res.ok) itemsSynced += accepted.length;
      else errors.push({ item: 'images', message: res.error ?? `HTTP ${res.status}` });
    }

    const propRes = await this.sendJson(
      config,
      'PUT',
      `/properties/${encodeURIComponent(config.hotelId)}`,
      mapPropertyForExpedia(params.property),
    );
    if (propRes.ok) itemsSynced += 1;
    else errors.push({ item: 'property', message: propRes.error ?? `HTTP ${propRes.status}` });

    return { success: errors.length === 0, itemsSynced, errors };
  }

  /** Expedia pushes bookings (Booking Notification) — there is no pull. */
  async pullReservations(_params: ReservationPullParams): Promise<ChannelReservationResult> {
    return { success: true, reservations: [], errors: [] };
  }

  async confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const body = buildBookingConfirmation(config.username, config.password, [
      { externalConfirmation: params.externalConfirmation, pmsConfirmation: params.pmsConfirmationNumber },
    ]);
    const xml = buildExpediaXml('BookingConfirmRQ', EXPEDIA_BC_NS, body);
    const res = await this.sendXml(config, '/eqc/bc', xml);
    return {
      success: res.success,
      itemsSynced: res.success ? 1 : 0,
      errors: res.errors.map((e) => ({ item: params.externalConfirmation, message: `[${e.code}] ${e.message}` })),
    };
  }

  /** Cancellations arrive via Booking Notification; nothing to push back. */
  async cancelReservation(_params: CancelReservationParams): Promise<ChannelSyncResult> {
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<{ connected: boolean; message: string }> {
    const cfg = this.buildConfig(config);
    // Empty AR update as a connectivity/auth probe.
    const body = mapAvailabilityToExpedia(cfg.hotelId, cfg.username, cfg.password, []);
    const xml = buildExpediaXml('AvailRateUpdateRQ', EXPEDIA_AR_NS, body);
    const res = await this.sendXml(cfg, '/eqc/ar', xml);
    return {
      connected: res.success || res.errors.length === 0,
      message: res.success
        ? `Connected to Expedia for hotel ${cfg.hotelId}`
        : `Connection test failed: ${res.errors.map((e) => e.message).join(', ')}`,
    };
  }

  // --- Private ---

  private async sendAr(
    config: ExpediaConfig,
    body: Record<string, unknown>,
    count: number,
    label: string,
  ): Promise<ChannelSyncResult> {
    const xml = buildExpediaXml('AvailRateUpdateRQ', EXPEDIA_AR_NS, body);
    const res = await this.sendXml(config, '/eqc/ar', xml);
    if (!res.success) {
      return { success: false, itemsSynced: 0, errors: res.errors.map((e) => ({ item: label, message: `[${e.code}] ${e.message}` })) };
    }
    return { success: true, itemsSynced: count, errors: [] };
  }

  private async sendXml(config: ExpediaConfig, path: string, xml: string) {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const result = await this.fetchWithRetry(config, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });
    if (!result.ok) {
      return { success: false, messageName: 'Error', data: {}, errors: [{ code: 'NETWORK', message: result.error ?? 'Unknown error' }] };
    }
    return parseExpediaResponse(result.text);
  }

  private async sendJson(
    config: ExpediaConfig,
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; error?: string }> {
    const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
    const authHeader = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const result = await this.fetchWithRetry(config, url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    return result.ok ? { ok: true, status: result.status } : { ok: false, status: result.status, error: result.error };
  }

  private async fetchWithRetry(
    config: ExpediaConfig,
    url: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
    await assertSafeChannelEndpoint(url); // SSRF: baseUrl is tenant-supplied
    const timeoutMs = config.timeoutMs ?? 30_000;
    const maxRetries = config.maxRetries ?? 3;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
        clearTimeout(timer);
        const text = await res.text();
        if (!res.ok) {
          this.logger.warn(`Expedia ${init.method} ${url} HTTP ${res.status} (attempt ${attempt}/${maxRetries})`);
          lastError = new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
          if (attempt < maxRetries) continue;
          return { ok: false, status: res.status, text, error: lastError.message };
        }
        return { ok: true, status: res.status, text };
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Expedia ${init.method} ${url} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
        if (attempt < maxRetries) continue;
      }
    }
    return { ok: false, status: 0, text: '', error: lastError?.message ?? 'Unknown error' };
  }

  private resolveConfig(connectionConfig?: Record<string, unknown>): ExpediaConfig {
    return this.buildConfig(connectionConfig ?? {});
  }

  private buildConfig(config: Record<string, unknown>): ExpediaConfig {
    const get = (k: string, env: string, def: string) => {
      const v = config[k];
      return v != null && v !== '' ? String(v) : this.configService.get<string>(env, def);
    };
    return {
      hotelId: get('hotelId', 'EXPEDIA_HOTEL_ID', 'MOCK_EXP_HOTEL'),
      username: get('username', 'EXPEDIA_USERNAME', 'haip_test'),
      password: get('password', 'EXPEDIA_PASSWORD', 'test_password'),
      baseUrl: get('baseUrl', 'EXPEDIA_BASE_URL', DEFAULT_EXPEDIA_CONFIG.baseUrl!),
      timeoutMs: DEFAULT_EXPEDIA_CONFIG.timeoutMs,
      maxRetries: DEFAULT_EXPEDIA_CONFIG.maxRetries,
    };
  }
}
