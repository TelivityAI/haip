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
import type { SiteMinderConfig } from './siteminder.config';
import { DEFAULT_SITEMINDER_CONFIG } from './siteminder.config';
import { buildSoapEnvelope, parseSoapResponse } from './siteminder.soap';
import {
  mapAvailabilityToOta,
  mapRatesToOta,
  mapSiteMinderReservationToHaip,
  buildNotifConfirmation,
} from './siteminder.mapper';
import { mapContentToOta } from './siteminder.content-mapper';

@Injectable()
export class SiteMinderAdapter implements ChannelAdapter {
  readonly adapterType = 'siteminder';
  private readonly logger = new Logger(SiteMinderAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Push availability + restrictions combined (SiteMinder convention).
   */
  async pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = mapAvailabilityToOta(config.hotelCode, params.items);
    const soap = buildSoapEnvelope(
      'OTA_HotelAvailNotifRQ',
      payload,
      config.username,
      config.password,
    );

    const response = await this.sendRequest(config, soap, 'OTA_HotelAvailNotifRQ');

    if (!response.success) {
      return {
        success: false,
        itemsSynced: 0,
        errors: response.errors.map((e) => ({
          item: 'availability',
          message: `[${e.code}] ${e.message}`,
        })),
      };
    }

    return { success: true, itemsSynced: params.items.length, errors: [] };
  }

  async pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = mapRatesToOta(config.hotelCode, params.items);
    const soap = buildSoapEnvelope(
      'OTA_HotelRateAmountNotifRQ',
      payload,
      config.username,
      config.password,
    );

    const response = await this.sendRequest(config, soap, 'OTA_HotelRateAmountNotifRQ');

    if (!response.success) {
      return {
        success: false,
        itemsSynced: 0,
        errors: response.errors.map((e) => ({
          item: 'rates',
          message: `[${e.code}] ${e.message}`,
        })),
      };
    }

    return { success: true, itemsSynced: params.items.length, errors: [] };
  }

  /**
   * SiteMinder includes restrictions in the availability message.
   * This method is a passthrough that builds a combined availability+restriction push.
   */
  async pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    // Build availability items from restriction items (zero availability = stop sell)
    const availItems = params.items.map((item) => ({
      channelRoomCode: item.channelRoomCode,
      date: item.date,
      available: item.stopSell ? 0 : 1,
      totalInventory: 1,
    }));

    const payload = mapAvailabilityToOta(config.hotelCode, availItems, params.items);
    const soap = buildSoapEnvelope(
      'OTA_HotelAvailNotifRQ',
      payload,
      config.username,
      config.password,
    );

    const response = await this.sendRequest(config, soap, 'OTA_HotelAvailNotifRQ');

    if (!response.success) {
      return {
        success: false,
        itemsSynced: 0,
        errors: response.errors.map((e) => ({
          item: 'restrictions',
          message: `[${e.code}] ${e.message}`,
        })),
      };
    }

    return { success: true, itemsSynced: params.items.length, errors: [] };
  }

  async pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = mapContentToOta(config.hotelCode, params);
    const soap = buildSoapEnvelope(
      'OTA_HotelDescriptiveContentNotifRQ',
      payload,
      config.username,
      config.password,
    );

    const response = await this.sendRequest(config, soap, 'OTA_HotelDescriptiveContentNotifRQ');

    if (!response.success) {
      return {
        success: false,
        itemsSynced: 0,
        errors: response.errors.map((e) => ({ item: 'content', message: `[${e.code}] ${e.message}` })),
      };
    }

    return { success: true, itemsSynced: 1 + params.roomTypes.length, errors: [] };
  }

  /**
   * Pull reservations via ReadRQ (SiteMinder is pull-only, no webhook push).
   */
  async pullReservations(params: ReservationPullParams): Promise<ChannelReservationResult> {
    const config = this.resolveConfig(params.connectionConfig);

    const readBody: Record<string, unknown> = {
      ReadRequests: {
        HotelReadRequest: {
          '@_HotelCode': config.hotelCode,
        },
      },
    };

    const soap = buildSoapEnvelope('ReadRQ', readBody, config.username, config.password);
    const response = await this.sendRequest(config, soap, 'ReadRQ');

    if (!response.success) {
      return {
        success: false,
        reservations: [],
        errors: response.errors.map((e) => ({
          externalId: '',
          message: `[${e.code}] ${e.message}`,
        })),
      };
    }

    try {
      const reservations = mapSiteMinderReservationToHaip(response.data);
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

  /**
   * Send NotifRQ to confirm reservation receipt.
   * SiteMinder re-sends unconfirmed reservations on next poll.
   */
  async confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const payload = buildNotifConfirmation(config.hotelCode, [
      {
        externalConfirmation: params.externalConfirmation,
        pmsConfirmation: params.pmsConfirmationNumber,
      },
    ]);

    const soap = buildSoapEnvelope('NotifRQ', payload, config.username, config.password);
    const response = await this.sendRequest(config, soap, 'NotifRQ');

    return {
      success: response.success,
      itemsSynced: response.success ? 1 : 0,
      errors: response.errors.map((e) => ({
        item: params.externalConfirmation,
        message: `[${e.code}] ${e.message}`,
      })),
    };
  }

  /**
   * SiteMinder doesn't have a direct cancel endpoint — cancellations
   * come through as reservation pulls with status=Cancel.
   * This is a no-op that returns success.
   */
  async cancelReservation(_params: CancelReservationParams): Promise<ChannelSyncResult> {
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async testConnection(
    config: Record<string, unknown>,
  ): Promise<{ connected: boolean; message: string }> {
    try {
      const smConfig = this.buildConfig(config);
      const soap = buildSoapEnvelope(
        'ReadRQ',
        {
          ReadRequests: {
            HotelReadRequest: { '@_HotelCode': smConfig.hotelCode },
          },
        },
        smConfig.username,
        smConfig.password,
      );

      const response = await this.sendRequest(smConfig, soap, 'ReadRQ');

      if (response.isFault) {
        return {
          connected: false,
          message: `Auth failed: ${response.errors.map((e) => e.message).join(', ')}`,
        };
      }

      return {
        connected: true,
        message: `Connected to SiteMinder for hotel ${smConfig.hotelCode}`,
      };
    } catch (error: any) {
      return { connected: false, message: `Connection failed: ${error.message}` };
    }
  }

  // --- Private ---

  private async sendRequest(
    config: SiteMinderConfig,
    soapXml: string,
    soapAction: string,
  ): Promise<ReturnType<typeof parseSoapResponse>> {
    const url = config.baseUrl;
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
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: soapAction,
          },
          body: soapXml,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const responseText = await res.text();

        // SOAP services return 200 even for faults sometimes,
        // but also may return 500 for SOAP faults — parse either way
        if (!res.ok && res.status !== 500) {
          this.logger.warn(
            `SiteMinder ${soapAction} HTTP ${res.status} (attempt ${attempt}/${maxRetries})`,
          );
          lastError = new Error(`HTTP ${res.status}: ${responseText.substring(0, 200)}`);
          if (attempt < maxRetries) continue;
          break;
        }

        return parseSoapResponse(responseText);
      } catch (error: any) {
        lastError = error;
        this.logger.warn(
          `SiteMinder ${soapAction} failed (attempt ${attempt}/${maxRetries}): ${error.message}`,
        );
        if (attempt < maxRetries) continue;
      }
    }

    return {
      success: false,
      messageName: 'Error',
      data: {},
      errors: [{ code: 'NETWORK', message: lastError?.message ?? 'Unknown error' }],
      isFault: false,
    };
  }

  /**
   * Resolve SiteMinder config.
   * Prefers per-connection credentials from channelConnections.config (passed via params.connectionConfig);
   * falls back to env vars only when a value is missing from the connection record.
   */
  private resolveConfig(connectionConfig?: Record<string, unknown>): SiteMinderConfig {
    return this.buildConfig(connectionConfig ?? {});
  }

  private buildConfig(config: Record<string, unknown>): SiteMinderConfig {
    const hotelCode = config['hotelCode'];
    const username = config['username'];
    const password = config['password'];
    const baseUrl = config['baseUrl'];
    return {
      hotelCode: hotelCode != null && hotelCode !== ''
        ? String(hotelCode)
        : this.configService.get<string>('SITEMINDER_HOTEL_CODE', 'MOCK_SM_HOTEL'),
      username: username != null && username !== ''
        ? String(username)
        : this.configService.get<string>('SITEMINDER_USERNAME', 'haip_test'),
      password: password != null && password !== ''
        ? String(password)
        : this.configService.get<string>('SITEMINDER_PASSWORD', 'test_password'),
      baseUrl: baseUrl != null && baseUrl !== ''
        ? String(baseUrl)
        : this.configService.get<string>('SITEMINDER_BASE_URL', DEFAULT_SITEMINDER_CONFIG.baseUrl!),
      timeoutMs: DEFAULT_SITEMINDER_CONFIG.timeoutMs,
      maxRetries: DEFAULT_SITEMINDER_CONFIG.maxRetries,
    };
  }
}
