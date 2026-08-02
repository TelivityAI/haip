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
import { DEFAULT_CHANNEX_CONFIG, type ChannexConfig } from './channex.config';
import {
  extractChannexTaskIds,
  mapAvailabilityToChannex,
  mapChannexRevisionToHaip,
  mapRatesToChannex,
  mapRestrictionsToChannex,
} from './channex.mapper';

type ConsoleStub = ReturnType<typeof createConsoleChannelStub>;

/**
 * Channex channel manager — ARI push via /availability and /restrictions,
 * booking pull via booking_revisions/feed, ACK via booking_revisions/{id}/ack.
 *
 * Env: CHANNEX_API_KEY, CHANNEX_PROPERTY_ID, optional CHANNEX_BASE_URL
 * (staging: https://staging.channex.io/api/v1).
 * Connection config may override apiKey, propertyId, hotelId, baseUrl.
 *
 * Certification hardening: 429/5xx retry+backoff, ~20 ARI req/min pacing,
 * task id capture, date-range collapse in mappers.
 */
@Injectable()
export class ChannexAdapter implements ChannelAdapter {
  readonly adapterType = 'channex';
  private readonly logger = new Logger(ChannexAdapter.name);
  private readonly consoleStub: ConsoleStub;
  private readonly fetchFn: ChannelFetchFn = fetch;
  /** Sliding window of outbound ARI request timestamps (rate limit ≈ 20/min). */
  private readonly ariRequestTimes: number[] = [];

  constructor(private readonly configService: ConfigService) {
    this.consoleStub = createConsoleChannelStub('Channex');
  }

  private resolveConfig(connectionConfig?: Record<string, unknown>): ChannexConfig | null {
    const apiKey =
      (connectionConfig?.['apiKey'] as string | undefined)?.trim() ||
      this.configService.get<string>('CHANNEX_API_KEY')?.trim();
    const propertyId =
      (connectionConfig?.['propertyId'] as string | undefined)?.trim() ||
      (connectionConfig?.['hotelId'] as string | undefined)?.trim() ||
      this.configService.get<string>('CHANNEX_PROPERTY_ID')?.trim();
    if (!apiKey || !propertyId) return null;

    const baseUrl = (
      (connectionConfig?.['baseUrl'] as string | undefined) ||
      this.configService.get<string>('CHANNEX_BASE_URL', DEFAULT_CHANNEX_CONFIG.baseUrl)
    ).replace(/\/$/, '');

    return {
      apiKey,
      propertyId,
      baseUrl,
      timeoutMs: DEFAULT_CHANNEX_CONFIG.timeoutMs,
      maxRetries: DEFAULT_CHANNEX_CONFIG.maxRetries,
      ariRateLimitPerMinute: DEFAULT_CHANNEX_CONFIG.ariRateLimitPerMinute,
    };
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'user-api-key': apiKey,
    };
  }

  private async paceAriRequest(config: ChannexConfig): Promise<void> {
    const limit = config.ariRateLimitPerMinute ?? 20;
    const now = Date.now();
    while (this.ariRequestTimes.length > 0 && now - this.ariRequestTimes[0]! >= 60_000) {
      this.ariRequestTimes.shift();
    }
    if (this.ariRequestTimes.length >= limit) {
      const waitMs = 60_000 - (now - this.ariRequestTimes[0]!) + 25;
      this.logger.warn(`Channex ARI rate limit — waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 50)));
    }
    this.ariRequestTimes.push(Date.now());
  }

  private async postValues(
    config: ChannexConfig,
    path: string,
    values: Array<Record<string, unknown>>,
    itemLabel: string,
  ): Promise<ChannelSyncResult> {
    if (values.length === 0) {
      return { success: true, itemsSynced: 0, errors: [], taskIds: [] };
    }

    await this.paceAriRequest(config);

    const url = `${config.baseUrl}/${path}`;
    const maxRetries = config.maxRetries ?? 3;
    let lastError = 'Request failed';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const res = await channelJsonRequest<{ data?: unknown; meta?: { warnings?: unknown[] } }>(
        url,
        {
          method: 'POST',
          headers: this.headers(config.apiKey),
          body: JSON.stringify({ values }),
          signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
        },
        this.fetchFn,
      );

      if (res.ok) {
        const taskIds = extractChannexTaskIds(res.data);
        const warnings = res.data?.meta?.warnings;
        if (Array.isArray(warnings) && warnings.length > 0) {
          this.logger.warn(`Channex ${path}: ${warnings.length} warning(s)`);
        }
        this.logger.log(`Channex ${path}: ${values.length} value(s), taskIds=${taskIds.join(',') || 'none'}`);
        return { success: true, itemsSynced: values.length, errors: [], taskIds };
      }

      lastError = res.errorMessage ?? `HTTP ${res.status}`;
      const retryable = res.status === 429 || res.status >= 500 || res.status === 0;
      if (!retryable || attempt === maxRetries) {
        return {
          success: false,
          itemsSynced: 0,
          errors: [{ item: itemLabel, message: lastError }],
          taskIds: [],
        };
      }

      const backoffMs =
        res.status === 429
          ? Math.min(2_000 * attempt, 15_000)
          : Math.min(500 * 2 ** (attempt - 1), 8_000);
      this.logger.warn(
        `Channex ${path} failed (${lastError}) attempt ${attempt}/${maxRetries}; retry in ${backoffMs}ms`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    return {
      success: false,
      itemsSynced: 0,
      errors: [{ item: itemLabel, message: lastError }],
      taskIds: [],
    };
  }

  async pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushAvailability(params);
    const values = mapAvailabilityToChannex(config.propertyId, params.items);
    return this.postValues(config, 'availability', values, 'availability');
  }

  async pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushRates(params);
    const values = mapRatesToChannex(config.propertyId, params.items);
    return this.postValues(config, 'restrictions', values, 'rate');
  }

  async pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushRestrictions(params);
    const values = mapRestrictionsToChannex(config.propertyId, params.items);
    return this.postValues(config, 'restrictions', values, 'restrictions');
  }

  /** Channex property/room content is managed in Channex UI — stub success. */
  async pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pushContent(params);
    this.logger.log(
      `Channex pushContent skipped (manage content in Channex): ${params.property.name}`,
    );
    return { success: true, itemsSynced: 0, errors: [] };
  }

  async pullReservations(params: ReservationPullParams): Promise<ChannelReservationResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.pullReservations(params);

    const query = new URLSearchParams({
      'filter[property_id]': config.propertyId,
      'order[inserted_at]': 'asc',
    });
    const url = `${config.baseUrl}/booking_revisions/feed?${query.toString()}`;
    const res = await channelJsonRequest<{ data?: Array<Record<string, unknown>> }>(
      url,
      {
        method: 'GET',
        headers: this.headers(config.apiKey),
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        reservations: [],
        errors: [{ externalId: '', message: res.errorMessage ?? 'Feed request failed' }],
      };
    }

    const rows = res.data?.data ?? [];
    const reservations = rows
      .map((row) => mapChannexRevisionToHaip(row, config.propertyId))
      .filter((r): r is NonNullable<typeof r> => r != null);

    return { success: true, reservations, errors: [] };
  }

  async confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.confirmReservation(params);

    // ACK the revision id (not the stable booking id).
    const revisionId = params.externalRevisionId ?? params.externalConfirmation;
    const url = `${config.baseUrl}/booking_revisions/${encodeURIComponent(revisionId)}/ack`;
    const res = await channelJsonRequest(
      url,
      {
        method: 'POST',
        headers: this.headers(config.apiKey),
        body: '{}',
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return {
        success: false,
        itemsSynced: 0,
        errors: [{ item: 'ack', message: res.errorMessage ?? 'Ack failed' }],
      };
    }
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async cancelReservation(params: CancelReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    if (!config) return this.consoleStub.cancelReservation(params);
    this.logger.log(`Channex cancelReservation delegated to inbound feed: ${params.externalConfirmation}`);
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<{ connected: boolean; message: string }> {
    const resolved = this.resolveConfig(config);
    if (!resolved) return this.consoleStub.testConnection();

    const url = `${resolved.baseUrl}/properties/${encodeURIComponent(resolved.propertyId)}`;
    const res = await channelJsonRequest(
      url,
      {
        method: 'GET',
        headers: this.headers(resolved.apiKey),
        signal: AbortSignal.timeout(resolved.timeoutMs ?? 30_000),
      },
      this.fetchFn,
    );

    if (!res.ok) {
      return { connected: false, message: res.errorMessage ?? 'Connection test failed' };
    }
    return { connected: true, message: `Channex property reachable (${resolved.baseUrl})` };
  }
}
