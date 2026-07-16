import { Injectable } from '@nestjs/common';
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
} from '../channel-adapter.interface';

/**
 * MockChannelAdapter — test/development adapter.
 * Stores pushed data in memory. Returns canned results.
 * Real adapters (SiteMinder, DerbySoft, Booking.com, Expedia) replace this.
 */
@Injectable()
export class MockChannelAdapter implements ChannelAdapter {
  readonly adapterType = 'mock';

  // In-memory storage for pushed data (useful for testing)
  readonly pushedAvailability: Map<string, any[]> = new Map();
  readonly pushedRates: Map<string, any[]> = new Map();
  readonly pushedRestrictions: Map<string, any[]> = new Map();
  readonly pushedContent: Map<string, ContentPushParams> = new Map();
  readonly confirmedReservations: Map<string, string> = new Map();
  readonly cancelledReservations: Set<string> = new Set();

  async pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult> {
    this.pushedAvailability.set(params.channelConnectionId, params.items);
    return {
      success: true,
      itemsSynced: params.items.length,
      errors: [],
    };
  }

  async pushRates(params: RatePushParams): Promise<ChannelSyncResult> {
    this.pushedRates.set(params.channelConnectionId, params.items);
    return {
      success: true,
      itemsSynced: params.items.length,
      errors: [],
    };
  }

  async pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult> {
    this.pushedRestrictions.set(params.channelConnectionId, params.items);
    return {
      success: true,
      itemsSynced: params.items.length,
      errors: [],
    };
  }

  async pushContent(params: ContentPushParams): Promise<ChannelSyncResult> {
    this.pushedContent.set(params.channelConnectionId, params);
    return {
      success: true,
      itemsSynced: 1 + params.roomTypes.length,
      errors: [],
    };
  }

  async pullReservations(_params: ReservationPullParams): Promise<ChannelReservationResult> {
    // Mock returns empty — inbound reservations come via webhook, not polling
    return {
      success: true,
      reservations: [],
      errors: [],
    };
  }

  async confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult> {
    this.confirmedReservations.set(
      params.externalConfirmation,
      params.pmsConfirmationNumber,
    );
    return {
      success: true,
      itemsSynced: 1,
      errors: [],
    };
  }

  async cancelReservation(params: CancelReservationParams): Promise<ChannelSyncResult> {
    this.cancelledReservations.add(params.externalConfirmation);
    return {
      success: true,
      itemsSynced: 1,
      errors: [],
    };
  }

  async testConnection(_config: Record<string, unknown>): Promise<{ connected: boolean; message: string }> {
    return { connected: true, message: 'Mock adapter connected successfully' };
  }
}
