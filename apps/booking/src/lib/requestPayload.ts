import type { SubmitBookingRequest } from '../api/types';
import type { GuestInfo, SearchCriteria } from '../context/BookingFlowContext';
import type {
  BookingApplicationAnswers,
  SearchRate,
  SearchRoomType,
} from '../api/types';

export interface RequestPayloadState {
  idempotencyKey: string;
  criteria: SearchCriteria;
  roomType: SearchRoomType;
  rate: SearchRate;
  guest: GuestInfo;
  serviceIds: string[];
  applicationAnswers: BookingApplicationAnswers;
}

export function requestPayload(
  state: RequestPayloadState,
  card?: {
    setupIntentId: string;
    consentText: string;
    consentVersion: string;
  },
): SubmitBookingRequest {
  return {
    idempotencyKey: state.idempotencyKey,
    roomTypeId: state.roomType.roomTypeId,
    ratePlanId: state.rate.ratePlanId,
    checkIn: state.criteria.checkIn,
    checkOut: state.criteria.checkOut,
    adults: state.criteria.adults,
    children: state.criteria.children,
    guestFirstName: state.guest.firstName,
    guestLastName: state.guest.lastName,
    guestEmail: state.guest.email,
    ...(state.guest.phone ? { guestPhone: state.guest.phone } : {}),
    ...(state.guest.specialRequests
      ? { specialRequests: state.guest.specialRequests }
      : {}),
    ...(state.serviceIds.length > 0 ? { serviceIds: state.serviceIds } : {}),
    applicationAnswers: state.applicationAnswers,
    ...(card
      ? {
          setupIntentId: card.setupIntentId,
          consentAccepted: true as const,
          consentText: card.consentText,
          consentVersion: card.consentVersion,
        }
      : {}),
  };
}
