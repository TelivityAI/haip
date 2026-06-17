import { createContext, useContext, useMemo, useState } from 'react';
import type {
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

  quote?: QuoteResponse;
  setQuote: (q?: QuoteResponse) => void;

  guest?: GuestInfo;
  setGuest: (g: GuestInfo) => void;

  reset: () => void;
}

const BookingFlowContext = createContext<BookingFlowState | null>(null);

export function BookingFlowProvider({ children }: { children: React.ReactNode }) {
  const [criteria, setCriteria] = useState<SearchCriteria>();
  const [branding, setBranding] = useState<Branding>();
  const [roomType, setRoomType] = useState<SearchRoomType>();
  const [rate, setRate] = useState<SearchRate>();
  const [quote, setQuote] = useState<QuoteResponse>();
  const [guest, setGuest] = useState<GuestInfo>();

  const value = useMemo<BookingFlowState>(
    () => ({
      criteria,
      setCriteria,
      branding,
      setBranding,
      roomType,
      rate,
      setSelection: (rt, r) => {
        setRoomType(rt);
        setRate(r);
      },
      quote,
      setQuote,
      guest,
      setGuest,
      reset: () => {
        setRoomType(undefined);
        setRate(undefined);
        setQuote(undefined);
        setGuest(undefined);
      },
    }),
    [criteria, branding, roomType, rate, quote, guest],
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
