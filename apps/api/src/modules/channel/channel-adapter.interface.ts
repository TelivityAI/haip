/**
 * ChannelAdapter — the abstraction every channel manager/OTA implements (KB 6.1).
 * Same pattern as OTAIP's ConnectAdapter for air.
 *
 * PMS pushes ARI out, channels push reservations in.
 * Real adapters (SiteMinder, DerbySoft) implement this interface.
 */
export interface ChannelAdapter {
  readonly adapterType: string;

  pushAvailability(params: AvailabilityPushParams): Promise<ChannelSyncResult>;
  pushRates(params: RatePushParams): Promise<ChannelSyncResult>;
  pushRestrictions(params: RestrictionPushParams): Promise<ChannelSyncResult>;
  pushContent(params: ContentPushParams): Promise<ChannelSyncResult>;
  pullReservations(params: ReservationPullParams): Promise<ChannelReservationResult>;
  confirmReservation(params: ConfirmReservationParams): Promise<ChannelSyncResult>;
  cancelReservation(params: CancelReservationParams): Promise<ChannelSyncResult>;
  testConnection(config: Record<string, unknown>): Promise<{ connected: boolean; message: string }>;
}

/**
 * Descriptive content pushed to an OTA/channel: property and room-type marketing
 * data (descriptions, amenities) plus images sourced from the media table.
 * Distinct from ARI (availability/rates/inventory) — most channels expose a
 * separate content/descriptive API for this.
 */
export interface ContentMediaItem {
  url: string;
  category: string;
  caption?: string | null;
  isPrimary: boolean;
  sortOrder: number;
  // Optional metadata (present for uploaded media; null for external/stock URLs).
  // Used by adapters to validate against per-OTA image limits.
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
}

export interface ContentPushParams {
  propertyId: string;
  channelConnectionId: string;
  connectionConfig?: Record<string, unknown>;
  property: {
    name: string;
    description?: string | null;
    address?: string | null;
    city?: string | null;
    countryCode?: string | null;
    starRating?: number | null;
    amenities?: string[];
    images: ContentMediaItem[];
  };
  roomTypes: Array<{
    channelRoomCode: string;
    name: string;
    description?: string | null;
    maxOccupancy?: number | null;
    bedType?: string | null;
    amenities?: string[];
    images: ContentMediaItem[];
  }>;
}

export interface AvailabilityPushParams {
  propertyId: string;
  channelConnectionId: string;
  /**
   * Per-connection credentials/config from channelConnections.config.
   * Adapters use this when set; fall back to env vars only when missing.
   */
  connectionConfig?: Record<string, unknown>;
  items: Array<{
    channelRoomCode: string;
    date: string;
    available: number;
    totalInventory: number;
  }>;
}

export interface RatePushParams {
  propertyId: string;
  channelConnectionId: string;
  connectionConfig?: Record<string, unknown>;
  items: Array<{
    channelRoomCode: string;
    channelRateCode: string;
    date: string;
    amount: number;
    currencyCode: string;
    singleOccupancy?: number;
    extraAdult?: number;
    extraChild?: number;
  }>;
}

export interface RestrictionPushParams {
  propertyId: string;
  channelConnectionId: string;
  connectionConfig?: Record<string, unknown>;
  items: Array<{
    channelRoomCode: string;
    channelRateCode: string;
    date: string;
    stopSell: boolean;
    closedToArrival: boolean;
    closedToDeparture: boolean;
    minLos?: number;
    maxLos?: number;
  }>;
}

export interface ReservationPullParams {
  propertyId: string;
  channelConnectionId: string;
  connectionConfig?: Record<string, unknown>;
  since?: Date;
}

export interface ChannelReservation {
  externalConfirmation: string;
  channelCode: string;
  guestFirstName: string;
  guestLastName: string;
  guestEmail?: string;
  guestPhone?: string;
  channelRoomCode: string;
  channelRateCode: string;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  totalAmount: number;
  currencyCode: string;
  specialRequests?: string;
  status: 'new' | 'modified' | 'cancelled';
  channelBookingDate: Date;
  rawPayload?: Record<string, unknown>;
}

export interface ConfirmReservationParams {
  channelConnectionId: string;
  connectionConfig?: Record<string, unknown>;
  externalConfirmation: string;
  pmsConfirmationNumber: string;
}

export interface CancelReservationParams {
  channelConnectionId: string;
  connectionConfig?: Record<string, unknown>;
  externalConfirmation: string;
  reason?: string;
}

export interface ChannelSyncResult {
  success: boolean;
  itemsSynced: number;
  errors: Array<{ item: string; message: string }>;
}

export interface ChannelReservationResult {
  success: boolean;
  reservations: ChannelReservation[];
  errors: Array<{ externalId: string; message: string }>;
}
