import { Logger } from '@nestjs/common';
import type {
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
 * When channel credentials are missing, log operations and return success stubs
 * so local dev and CI never require live Beds24/Channex keys.
 */
export function createConsoleChannelStub(providerLabel: string) {
  const logger = new Logger(`${providerLabel}ChannelAdapter`);

  const warn = (op: string) => {
    logger.warn(
      `[console] ${providerLabel} ${op} — channel credentials not configured; no HTTP call`,
    );
  };

  return {
    pushAvailability: async (params: AvailabilityPushParams): Promise<ChannelSyncResult> => {
      warn('pushAvailability');
      return { success: true, itemsSynced: params.items.length, errors: [] };
    },
    pushRates: async (params: RatePushParams): Promise<ChannelSyncResult> => {
      warn('pushRates');
      return { success: true, itemsSynced: params.items.length, errors: [] };
    },
    pushRestrictions: async (params: RestrictionPushParams): Promise<ChannelSyncResult> => {
      warn('pushRestrictions');
      return { success: true, itemsSynced: params.items.length, errors: [] };
    },
    pushContent: async (params: ContentPushParams): Promise<ChannelSyncResult> => {
      warn('pushContent');
      return { success: true, itemsSynced: 1 + params.roomTypes.length, errors: [] };
    },
    pullReservations: async (_params: ReservationPullParams): Promise<ChannelReservationResult> => {
      warn('pullReservations');
      return { success: true, reservations: [], errors: [] };
    },
    confirmReservation: async (_params: ConfirmReservationParams): Promise<ChannelSyncResult> => {
      warn('confirmReservation');
      return { success: true, itemsSynced: 1, errors: [] };
    },
    cancelReservation: async (_params: CancelReservationParams): Promise<ChannelSyncResult> => {
      warn('cancelReservation');
      return { success: true, itemsSynced: 1, errors: [] };
    },
    testConnection: async (): Promise<{ connected: boolean; message: string }> => {
      warn('testConnection');
      return {
        connected: false,
        message: `${providerLabel} credentials not configured (console mode)`,
      };
    },
  };
}
