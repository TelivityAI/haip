import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  UNSAFE_DataRouterContext,
  useBlocker,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import type {
  BookingApplicationAnswers,
  BookingRequestAcknowledgement,
  Branding,
  QuoteResponse,
  SearchRate,
  SearchRoomType,
  SubmitBookingRequest,
} from '../api/types';
import { bookingApi } from '../api/client';

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

  requestSubmissionStatus: 'idle' | 'pending' | 'success' | 'error';
  requestSubmissionError?: unknown;
  submitRequest: (
    request: SubmitBookingRequest,
  ) => Promise<BookingRequestAcknowledgement>;

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
  requestSubmissionStatus: 'idle' | 'pending' | 'success' | 'error';
  requestSubmissionError?: unknown;
}

type BookingFlowAction =
  | { type: 'patch'; value: Partial<BookingFlowData> }
  | { type: 'selection'; roomType: SearchRoomType; rate: SearchRate }
  | { type: 'reset' };

const initialFlow: BookingFlowData = {
  serviceIds: [],
  applicationAnswers: {},
  requestSubmissionStatus: 'idle',
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
        requestSubmissionStatus: 'idle',
      };
  }
}

const BookingFlowContext = createContext<BookingFlowState | null>(null);

export function BookingFlowProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(bookingFlowReducer, initialFlow);
  const requestKey = useRef<string>();
  const requestSubmission = useRef<Promise<BookingRequestAcknowledgement>>();

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
      submitRequest: (request) => {
        if (requestSubmission.current) return requestSubmission.current;

        dispatch({
          type: 'patch',
          value: {
            requestAcknowledgement: undefined,
            requestSubmissionStatus: 'pending',
            requestSubmissionError: undefined,
          },
        });
        const pendingRequest = bookingApi
          .submitRequest(request)
          .then((requestAcknowledgement) => {
            dispatch({
              type: 'patch',
              value: {
                requestAcknowledgement,
                requestSubmissionStatus: 'success',
              },
            });
            return requestAcknowledgement;
          })
          .catch((requestSubmissionError: unknown) => {
            dispatch({
              type: 'patch',
              value: {
                requestSubmissionStatus: 'error',
                requestSubmissionError,
              },
            });
            throw requestSubmissionError;
          })
          .finally(() => {
            if (requestSubmission.current === pendingRequest) {
              requestSubmission.current = undefined;
            }
          });
        requestSubmission.current = pendingRequest;
        return pendingRequest;
      },
      reset: () => {
        requestKey.current = undefined;
        requestSubmission.current = undefined;
        dispatch({ type: 'reset' });
      },
    }),
    [state],
  );

  return (
    <BookingFlowContext.Provider value={value}>
      {children}
      <RequestSubmissionEffects />
    </BookingFlowContext.Provider>
  );
}

export function useBookingFlow(): BookingFlowState {
  const ctx = useContext(BookingFlowContext);
  if (!ctx) throw new Error('useBookingFlow must be used within BookingFlowProvider');
  return ctx;
}

function RequestDataRouterBlocker({ isPending }: { isPending: boolean }) {
  const blocker = useBlocker(isPending);

  useEffect(() => {
    if (!isPending && blocker.state === 'blocked') blocker.reset();
  }, [blocker, isPending]);

  return null;
}

function RequestSubmissionEffects() {
  const {
    requestAcknowledgement,
    requestSubmissionStatus,
  } = useBookingFlow();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dataRouterContext = useContext(UNSAFE_DataRouterContext);
  const isPending = requestSubmissionStatus === 'pending';
  const redirectedRequestId = useRef<string>();

  useEffect(() => {
    if (!isPending) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [isPending]);

  useEffect(() => {
    if (requestSubmissionStatus === 'idle') {
      redirectedRequestId.current = undefined;
      return;
    }
    if (
      requestSubmissionStatus !== 'success' ||
      !requestAcknowledgement ||
      redirectedRequestId.current === requestAcknowledgement.requestId
    ) {
      return;
    }
    redirectedRequestId.current = requestAcknowledgement.requestId;
    if (pathname !== '/request/received') {
      navigate('/request/received', { replace: true });
    }
  }, [
    navigate,
    pathname,
    requestAcknowledgement,
    requestSubmissionStatus,
  ]);

  return dataRouterContext ? (
    <RequestDataRouterBlocker isPending={isPending} />
  ) : null;
}
