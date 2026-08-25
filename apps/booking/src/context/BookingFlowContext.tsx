import { createContext, useContext, useMemo, useReducer, useRef } from 'react';
import type {
  BookingApplicationAnswers,
  BookingRequestAcknowledgement,
  Branding,
  QuoteResponse,
  SearchRate,
  SearchRoomType,
} from '../api/types';

/** Guest-entered search criteria + the selections built up across the flow. */
export interface SearchCriteria {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  promoCode?: string;
}

export interface GuestInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  specialRequests?: string;
}

interface BookingFlowState {
  criteria?: SearchCriteria;
  setCriteria: (c: SearchCriteria) => void;

  branding?: Branding;
  setBranding: (b?: Branding) => void;

  roomType?: SearchRoomType;
  rate?: SearchRate;
  setSelection: (roomType: SearchRoomType, rate: SearchRate) => void;

  serviceIds: string[];
  setServiceIds: (ids: string[]) => void;

  quote?: QuoteResponse;
  setQuote: (q?: QuoteResponse) => void;

  guest?: GuestInfo;
  setGuest: (g: GuestInfo) => void;

  applicationAnswers: BookingApplicationAnswers;
  setApplicationAnswers: (answers: BookingApplicationAnswers) => void;

  setupIntentId?: string;
  setSetupIntentId: (id?: string) => void;

  setupIntentConsentText?: string;
  setSetupIntentConsentText: (text?: string) => void;

  requestAcknowledgement?: BookingRequestAcknowledgement;
  setRequestAcknowledgement: (ack?: BookingRequestAcknowledgement) => void;

  requestIdempotencyKey?: string;
  ensureRequestIdempotencyKey: () => string;

  reset: () => void;
}

interface BookingFlowData {
  criteria?: SearchCriteria;
  branding?: Branding;
  roomType?: SearchRoomType;
  rate?: SearchRate;
  serviceIds: string[];
  quote?: QuoteResponse;
  guest?: GuestInfo;
  applicationAnswers: BookingApplicationAnswers;
  setupIntentId?: string;
  setupIntentConsentText?: string;
  requestAcknowledgement?: BookingRequestAcknowledgement;
  requestIdempotencyKey?: string;
}

type BookingFlowAction =
  | { type: 'patch'; value: Partial<BookingFlowData> }
  | { type: 'selection'; roomType: SearchRoomType; rate: SearchRate }
  | { type: 'reset' };

const initialFlow: BookingFlowData = {
  serviceIds: [],
  applicationAnswers: {},
};

function bookingFlowReducer(
  state: BookingFlowData,
  action: BookingFlowAction,
): BookingFlowData {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.value };
    case 'selection':
      return {
        ...state,
        roomType: action.roomType,
        rate: action.rate,
        serviceIds: [],
      };
    case 'reset':
      return {
        criteria: state.criteria,
        branding: state.branding,
        serviceIds: [],
        applicationAnswers: {},
      };
  }
}

const BookingFlowContext = createContext<BookingFlowState | null>(null);

export function BookingFlowProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(bookingFlowReducer, initialFlow);
  const requestKey = useRef<string>();

  const value = useMemo<BookingFlowState>(
    () => ({
      ...state,
      setCriteria: (criteria) => dispatch({ type: 'patch', value: { criteria } }),
      setBranding: (branding) => dispatch({ type: 'patch', value: { branding } }),
      setSelection: (roomType, rate) =>
        dispatch({ type: 'selection', roomType, rate }),
      setServiceIds: (serviceIds) =>
        dispatch({ type: 'patch', value: { serviceIds } }),
      setQuote: (quote) => dispatch({ type: 'patch', value: { quote } }),
      setGuest: (guest) => dispatch({ type: 'patch', value: { guest } }),
      setApplicationAnswers: (applicationAnswers) =>
        dispatch({ type: 'patch', value: { applicationAnswers } }),
      setSetupIntentId: (setupIntentId) =>
        dispatch({ type: 'patch', value: { setupIntentId } }),
      setSetupIntentConsentText: (setupIntentConsentText) =>
        dispatch({ type: 'patch', value: { setupIntentConsentText } }),
      setRequestAcknowledgement: (requestAcknowledgement) =>
        dispatch({ type: 'patch', value: { requestAcknowledgement } }),
      ensureRequestIdempotencyKey: () => {
        if (state.requestIdempotencyKey) return state.requestIdempotencyKey;
        if (requestKey.current) return requestKey.current;
        const id = `booking-widget-${crypto.randomUUID()}`;
        requestKey.current = id;
        dispatch({
          type: 'patch',
          value: { requestIdempotencyKey: id },
        });
        return id;
      },
      reset: () => {
        requestKey.current = undefined;
        dispatch({ type: 'reset' });
      },
    }),
    [state],
  );

  return (
    <BookingFlowContext.Provider value={value}>
      {children}
    </BookingFlowContext.Provider>
  );
}

export function useBookingFlow(): BookingFlowState {
  const ctx = useContext(BookingFlowContext);
  if (!ctx) throw new Error('useBookingFlow must be used within BookingFlowProvider');
  return ctx;
}
