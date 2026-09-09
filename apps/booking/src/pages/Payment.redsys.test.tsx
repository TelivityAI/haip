import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Payment } from './Payment';
import type { BookingConfig, QuoteResponse } from '../api/types';

const navigate = vi.fn();
const bookMock = vi.fn();
const submitRedirect = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('../api/client', () => ({
  bookingApi: {
    book: (...args: unknown[]) => bookMock(...args),
  },
  errorMessage: (e: unknown) => String(e),
}));

vi.mock('../lib/submit-redirect-next-action', () => ({
  submitRedirectNextAction: (...args: unknown[]) => submitRedirect(...args),
}));

vi.mock('../context/ConfigContext', () => ({
  useConfig: () => ({
    config: {
      paymentMethodClientMode: 'redsys',
      stripePublishableKey: null,
      depositPolicy: { type: 'first_night', refundable: true },
    } satisfies Partial<BookingConfig>,
  }),
}));

vi.mock('../context/BookingFlowContext', () => ({
  useBookingFlow: () => ({
    criteria: {
      checkIn: '2026-10-01',
      checkOut: '2026-10-03',
      adults: 2,
      children: 0,
    },
    roomType: { roomTypeId: 'rt-1', roomTypeName: 'Deluxe' },
    rate: { ratePlanId: 'rp-1', ratePlanName: 'BAR', totalAmount: 200 },
    quote: {
      nights: 2,
      currencyCode: 'EUR',
      lineItems: [],
      roomTotal: '180.00',
      taxTotal: '20.00',
      grandTotal: '200.00',
      depositPolicy: { type: 'first_night', refundable: true },
      depositDue: '100.00',
    } satisfies QuoteResponse,
    guest: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '',
      specialRequests: '',
    },
    serviceIds: [] as string[],
  }),
}));

function renderPayment() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Payment />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Payment redsys hosted redirect', () => {
  beforeEach(() => {
    navigate.mockReset();
    bookMock.mockReset();
    submitRedirect.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows Redsys pay button instead of Stripe when client mode is redsys', () => {
    renderPayment();
    expect(screen.getByRole('button', { name: /Pay deposit securely via Redsys/i })).toBeTruthy();
    expect(screen.queryByText(/Demo mode/i)).toBeNull();
  });

  it('books with redsys_redirect tokens and submits nextAction without navigating', async () => {
    const nextAction = {
      type: 'redirect' as const,
      url: 'https://sis-t.redsys.es:25443/sis/realizarPago',
      method: 'POST' as const,
      formFields: { Ds_SignatureVersion: 'HMAC_SHA512_V1' },
    };
    bookMock.mockResolvedValue({
      success: true,
      confirmationNumber: 'C1',
      reservationId: 'r1',
      status: 'confirmed',
      currencyCode: 'EUR',
      grandTotal: '200.00',
      deposit: {
        paymentId: 'p1',
        amount: '100.00',
        status: 'pending',
        nextAction,
      },
      lineItems: [],
      cancellationPolicy: '',
    });

    renderPayment();
    fireEvent.click(screen.getByRole('button', { name: /Pay deposit securely via Redsys/i }));

    await waitFor(() => expect(bookMock).toHaveBeenCalledTimes(1));
    const body = bookMock.mock.calls[0][0];
    expect(body.paymentToken).toBe('redsys_redirect');
    expect(body.redirectUrlOk).toMatch(/redsys=ok/);
    expect(body.redirectUrlKo).toMatch(/redsys=ko/);

    await waitFor(() => expect(submitRedirect).toHaveBeenCalledWith(nextAction));
    expect(navigate).not.toHaveBeenCalledWith(
      '/confirmation',
      expect.anything(),
    );
  });
});
