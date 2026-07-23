/**
 * Types mirror the public `/api/v1/booking-engine` contract. Field names match
 * the server responses (booking-engine.service.ts / connect-search.service.ts).
 * Everything is rendered defensively — optional where the server may omit it.
 */

export interface DepositPolicy {
  type: 'none' | 'first_night' | 'percentage' | 'full';
  percentage?: number;
  refundable: boolean;
}

export interface Branding {
  displayName?: string | null;
  logoMediaId?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

export interface BookingConfig {
  isEnabled: boolean;
  displayName?: string | null;
  logoMediaId?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  depositPolicy: DepositPolicy;
  stripePublishableKey?: string | null;
  sellableRoomTypeIds: string[];
  sellableRatePlanIds: string[];
}

// --- Search ---

export interface NightlyBreakdown {
  date: string;
  baseRate?: number;
  taxAmount?: number;
  totalRate?: number;
}

export interface SearchRate {
  ratePlanId: string;
  ratePlanName?: string;
  ratePlanCode?: string;
  rateType?: string;
  totalAmount: number;
  currencyCode?: string;
  nightlyBreakdown?: NightlyBreakdown[];
  cancellationPolicy?: { type?: string; description?: string };
  available?: boolean;
}

export interface SearchRoomType {
  roomTypeId: string;
  roomTypeName?: string;
  name?: string;
  description?: string | null;
  maxOccupancy?: number;
  bedType?: string | null;
  amenities?: string[];
  available?: number;
  images?: string[];
  rates?: SearchRate[];
}

export interface SearchProperty {
  sourcePropertyId?: string;
  propertyName?: string;
  starRating?: number | null;
  roomTypes?: SearchRoomType[];
}

export interface SearchResponse {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  branding: Branding;
  results: SearchProperty[];
}

export interface SearchRequest {
  checkIn: string;
  checkOut: string;
  roomTypeId?: string;
  adults?: number;
  children?: number;
  promoCode?: string;
}

// --- Quote ---

export interface QuoteLineItem {
  date: string;
  rate: string;
  tax: string;
}

export interface QuoteServiceLine {
  serviceId: string;
  code: string;
  name: string;
  postingRule: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  taxTotal: string;
}

export interface QuoteResponse {
  nights: number;
  currencyCode: string;
  lineItems: QuoteLineItem[];
  roomTotal: string;
  taxTotal: string;
  services?: QuoteServiceLine[];
  servicesTotal?: string;
  servicesTaxTotal?: string;
  grandTotal: string;
  depositPolicy: DepositPolicy;
  depositDue: string;
  cancellationPolicy?: {
    type?: string;
    description?: string;
    freeCancelHoursBeforeArrival?: number;
  };
}

export interface QuoteRequest {
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number;
  serviceIds?: string[];
}

// --- Book ---

export interface BookRequest {
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone?: string;
  adults: number;
  children?: number;
  specialRequests?: string;
  paymentToken?: string;
  cardLastFour?: string;
  cardBrand?: string;
  serviceIds?: string[];
}

export interface BookResponse {
  success: boolean;
  confirmationNumber: string;
  reservationId: string;
  status: string;
  currencyCode: string;
  grandTotal: string;
  deposit?: { paymentId: string; amount: string; status: string } | null;
  lineItems: QuoteLineItem[];
  cancellationPolicy: string;
}

// --- Manage ---

export interface BookingDetails {
  status: string;
  confirmationNumber: string;
  reservationId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  rateAmount: number;
  currencyCode: string;
  folioBalance?: number;
}

export interface CancelResponse {
  cancelled: boolean;
  confirmationNumber: string;
  reservationId: string;
  status: string;
}

// --- Extras ---

export interface SellableService {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  chargeType: string;
  price: string;
  currencyCode: string;
  postingRule: string;
}

export interface SellableServicesResponse {
  propertyId: string;
  data: SellableService[];
}
