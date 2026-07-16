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
import { DEFAULT_DERBYSOFT_CONFIG, type DerbySoftConfig } from './derbysoft.config';
import { DerbySoftClient } from './derbysoft.client';
import {
  mapAvailabilityToInventory,
  mapRatesToDerbySoft,
  mapRestrictionsToAvailability,
  mapPropertyToHotelUpdate,
  mapRoomTypesToUpdates,
  buildHeader,
  type AriUpdateType,
} from './derbysoft.mapper';

@Injectable()
export class DerbySoftAdapter implements ChannelAdapter {
  readonly adapterType = 'derbysoft';
  private readonly logger = new Logger(DerbySoftAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  private resolveConfig(connectionConfig?: Record<string, unknown>): DerbySoftConfig {
    const env = {
      hotelId: this.configService.get<string>('DERBYSOFT_HOTEL_ID', 'MOCK_DS_HOTEL'),
      accountId: this.configService.get<string>('DERBYSOFT_ACCOUNT_ID', 'haip_test'),
      clientSecret: this.configService.get<string>('DERBYSOFT_CLIENT_SECRET', 'test_password'),
      tunnelBaseUrl: this.configService.get<string>(
        'DERBYSOFT_TUNNEL_BASE_URL',
        DEFAULT_DERBYSOFT_CONFIG.tunnelBaseUrl!,
      ),
      profileBaseUrl: this.configService.get<string>(
        'DERBYSOFT_PROFILE_BASE_URL',
        DEFAULT_DERBYSOFT_CONFIG.profileBaseUrl!,
      ),
      tokenUrl: this.configService.get<string>(
        'DERBYSOFT_TOKEN_URL',
        DEFAULT_DERBYSOFT_CONFIG.tokenUrl!,
      ),
    };

    const cfg = { ...DEFAULT_DERBYSOFT_CONFIG, ...env, ...(connectionConfig ?? {}) } as DerbySoftConfig;

    // Accept hotelId aliases used elsewhere in HAIP channel configs.
    if (!cfg.hotelId && typeof connectionConfig?.['hotelCode'] === 'string') {
      cfg.hotelId = connectionConfig['hotelCode'] as string;
    }
    if (!cfg.accountId && typeof connectionConfig?.['clientId'] === 'string') {
      cfg.accountId = connectionConfig['clientId'] as string;
    }

    return cfg;
  }

  private ariType(config: DerbySoftConfig, override?: AriUpdateType): AriUpdateType {
    return override ?? config.ariUpdateType ?? 'Delta';
  }

  private client(config: DerbySoftConfig): DerbySoftClient {
    return new DerbySoftClient(config);
  }

  private async pushPayloads(
    client: DerbySoftClient,
    baseUrl: string,
    path: string,
    payloads: Array<Record<string, unknown>>,
    itemLabel: string,
  ): Promise<ChannelSyncResult> {
    const errors: Array<{ item: string; message: string }> = [];
    let itemsSynced = 0;
    const url = `${client.expandUrl(baseUrl).replace(/\/$/, '')}/${path}`;

    for (const payload of payloads) {
      const res = await client.postJson(url, payload);
      if (res.ok) {
        itemsSynced += 1;
      } else {
        const code = String(res.data['errorCode'] ?? res.status);
        const msg = String(res.data['errorMessage'] ?? `HTTP ${res.status}`);
        errors.push({ item: itemLabel, message: `[${code}] ${msg}` });
      }
    }

    return { success: errors.length === 0, itemsSynced, errors };
  }

  /** HAIP availability → PC Update Inventory. */
  async pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const type = this.ariType(config, params.connectionConfig?.['ariUpdateType'] as AriUpdateType | undefined);
    const payloads = mapAvailabilityToInventory(config.hotelId, params.items, type);
    if (payloads.length === 0) return { success: true, itemsSynced: 0, errors: [] };
    return this.pushPayloads(this.client(config), config.tunnelBaseUrl, 'inventory', payloads, 'inventory');
  }

  async pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const type = this.ariType(config, params.connectionConfig?.['ariUpdateType'] as AriUpdateType | undefined);
    const payloads = mapRatesToDerbySoft(config.hotelId, params.items, type);
    if (payloads.length === 0) return { success: true, itemsSynced: 0, errors: [] };
    return this.pushPayloads(this.client(config), config.tunnelBaseUrl, 'rate', payloads, 'rate');
  }

  /** HAIP restrictions → PC Update Availability (product-level). */
  async pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const type = this.ariType(config, params.connectionConfig?.['ariUpdateType'] as AriUpdateType | undefined);
    const payloads = mapRestrictionsToAvailability(config.hotelId, params.items, type);
    if (payloads.length === 0) return { success: true, itemsSynced: 0, errors: [] };
    return this.pushPayloads(
      this.client(config),
      config.tunnelBaseUrl,
      'availability',
      payloads,
      'availability',
    );
  }

  /**
   * Property + room-type profile sync via PC profile APIs.
   * Photos are not pushed here (DerbySoft content images are channel-specific);
   * descriptive hotel/room updates are sent.
   */
  async pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    return this.syncProperty(params);
  }

  /**
   * Explicit property sync (Update Hotel + Update RoomType).
   * Used by POST /channels/connections/:id/sync-property.
   */
  async syncProperty(params: ContentPushParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const client = this.client(config);
    const profileBase = client.expandUrl(config.profileBaseUrl).replace(/\/$/, '');
    const errors: Array<{ item: string; message: string }> = [];
    let itemsSynced = 0;

    const hotelBody = mapPropertyToHotelUpdate(config.hotelId, params.property);
    const hotelRes = await client.postJson(`${profileBase}/hotel`, hotelBody);
    if (hotelRes.ok) itemsSynced += 1;
    else {
      errors.push({
        item: 'hotel',
        message: `[${hotelRes.data['errorCode'] ?? hotelRes.status}] ${hotelRes.data['errorMessage'] ?? 'failed'}`,
      });
    }

    for (const roomBody of mapRoomTypesToUpdates(config.hotelId, params.roomTypes)) {
      const roomRes = await client.postJson(`${profileBase}/roomtype`, roomBody);
      if (roomRes.ok) itemsSynced += 1;
      else {
        errors.push({
          item: `roomtype:${roomBody['roomId']}`,
          message: `[${roomRes.data['errorCode'] ?? roomRes.status}] ${roomRes.data['errorMessage'] ?? 'failed'}`,
        });
      }
    }

    return { success: errors.length === 0, itemsSynced, errors };
  }

  /** Reservations are push (Book/Modify/Cancel webhooks) — no pull. */
  async pullReservations(_params: ReservationPullParams): Promise<ChannelReservationResult> {
    return { success: true, reservations: [], errors: [] };
  }

  /** Update Reservation Status → PC /resStatus. */
  async confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const client = this.client(config);
    const url = `${client.expandUrl(config.tunnelBaseUrl).replace(/\/$/, '')}/resStatus`;
    const body = {
      header: buildHeader(),
      hotelId: config.hotelId,
      reservationIds: {
        derbyResId: params.externalConfirmation,
        supplierResId: params.pmsConfirmationNumber,
      },
      status: 'Confirmed',
    };
    const res = await client.postJson(url, body);
    if (!res.ok) {
      return {
        success: false,
        itemsSynced: 0,
        errors: [
          {
            item: 'resStatus',
            message: `[${res.data['errorCode'] ?? res.status}] ${res.data['errorMessage'] ?? 'failed'}`,
          },
        ],
      };
    }
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async cancelReservation(params: CancelReservationParams): Promise<ChannelSyncResult> {
    const config = this.resolveConfig(params.connectionConfig);
    const client = this.client(config);
    const url = `${client.expandUrl(config.tunnelBaseUrl).replace(/\/$/, '')}/resStatus`;
    const body = {
      header: buildHeader(),
      hotelId: config.hotelId,
      reservationIds: {
        derbyResId: params.externalConfirmation,
      },
      status: 'Cancelled',
      reason: params.reason,
    };
    const res = await client.postJson(url, body);
    if (!res.ok) {
      return {
        success: false,
        itemsSynced: 0,
        errors: [
          {
            item: 'resStatus',
            message: `[${res.data['errorCode'] ?? res.status}] ${res.data['errorMessage'] ?? 'failed'}`,
          },
        ],
      };
    }
    return { success: true, itemsSynced: 1, errors: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<{ connected: boolean; message: string }> {
    try {
      const resolved = this.resolveConfig(config);
      const client = this.client(resolved);
      await client.getAccessToken();
      return { connected: true, message: 'DerbySoft token obtained successfully' };
    } catch (err: any) {
      this.logger.warn(`DerbySoft testConnection failed: ${err?.message}`);
      return { connected: false, message: err?.message ?? 'Connection test failed' };
    }
  }
}
