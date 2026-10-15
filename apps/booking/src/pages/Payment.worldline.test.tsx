import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Payment } from './Payment';
import type { BookingConfig, QuoteResponse } from '../api/types';

const navigate = vi.fn();
const bookMock = vi.fn();
const tokenizationMock = vi.fn();
const submitRedirect = vi.fn();
const submitTokenization = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../api/client', () => ({
  bookingApi: {
    book: (...args: unknown[]) => bookMock(...args),
    worldlineTokenization: (...args: unknown[]) => tokenizationMock(...args),
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../lib/submit-redirect-next-action', () => ({
  submitRedirectNextAction: (...args: unknown[]) => submitRedirect(...args),
}));

vi.mock('../context/ConfigContext', () => ({
  useConfig: () => ({
    config: {
      paymentMethodClientMode: 'worldline',
      stripePublishableKey: null,
      depositPolicy: { type: 'first_night', refundable: true },
    } satisfies Partial<BookingConfig>,
  }),
}));

vi.mock('../context/BookingFlowContext', () => ({
  useBookingFlow: () => ({
    criteria: { checkIn: '2026-10-01', checkOut: '2026-10-03', adults: 2, children: 0 },
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
    guest: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '', specialRequests: '' },
    serviceIds: [] as string[],
  }),
}));

function renderPayment() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Payment />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Payment in-page card field', () => {
  beforeEach(() => {
    navigate.mockReset();
    bookMock.mockReset();
    tokenizationMock.mockReset();
    submitRedirect.mockReset();
    submitTokenization.mockReset();
    tokenizationMock.mockResolvedValue({
      hostedTokenizationUrl: 'https://payment.preprod.direct.worldline-solutions.com/hostedtokenization/tokenization/form/session-1',
      sri: 'sha384-abc',
      tokenizerScriptUrl: 'https://payment.preprod.direct.worldline-solutions.com/hostedtokenization/js/client/tokenizer.min.js',
    });
    window.Tokenizer = class {
      initialize = vi.fn().mockResolvedValue(undefined);
      submitTokenization = submitTokenization;
    } as unknown as Window['Tokenizer'];
  });

  afterEach(() => {
    delete window.Tokenizer;
    vi.clearAllMocks();
  });

  it('books with the hosted tokenization id and stays on the page when no bank challenge is required', async () => {
    submitTokenization.mockResolvedValue({ success: true, hostedTokenizationId: 'ht-1' });
    bookMock.mockResolvedValue({
      success: true,
      confirmationNumber: 'C1',
      reservationId: 'r1',
      status: 'confirmed',
      currencyCode: 'EUR',
      grandTotal: '200.00',
      deposit: { paymentId: 'p1', amount: '100.00', status: 'held' },
      lineItems: [],
      cancellationPolicy: '',
    });

    renderPayment();
    fireEvent.click(await screen.findByRole('button', { name: /Pay & confirm booking/i }));
    await waitFor(() => expect(bookMock).toHaveBeenCalledTimes(1));
    expect(bookMock.mock.calls[0][0].paymentToken).toBe('ht-1');
    expect(bookMock.mock.calls[0][0].returnUrl).toBe(window.location.href);
    expect(JSON.stringify(bookMock.mock.calls[0][0])).not.toMatch(/cardNumber|cvv/i);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/confirmation', expect.anything()));
    expect(submitRedirect).not.toHaveBeenCalled();
  });

  it('follows a bank challenge redirect after the card is tokenized on the page', async () => {
    submitTokenization.mockResolvedValue({ success: true, hostedTokenizationId: 'ht-3ds' });
    const nextAction = {
      type: 'redirect' as const,
      url: 'https://bank.example/3ds',
      method: 'GET' as const,
      formFields: {},
    };
    bookMock.mockResolvedValue({
      success: true,
      confirmationNumber: 'C1',
      reservationId: 'r1',
      status: 'pending',
      currencyCode: 'EUR',
      grandTotal: '200.00',
      deposit: { paymentId: 'p1', amount: '100.00', status: 'pending_redirect', nextAction },
      lineItems: [],
      cancellationPolicy: '',
    });

    renderPayment();
    fireEvent.click(await screen.findByRole('button', { name: /Pay & confirm booking/i }));
    await waitFor(() => expect(submitRedirect).toHaveBeenCalledWith(nextAction));
    expect(navigate).not.toHaveBeenCalledWith('/confirmation', expect.anything());
  });

  it('does not book when the card field rejects the entry', async () => {
    submitTokenization.mockResolvedValue({ success: false, error: { message: 'Check the card' } });
    renderPayment();
    fireEvent.click(await screen.findByRole('button', { name: /Pay & confirm booking/i }));
    expect(await screen.findByText('Check the card')).toBeInTheDocument();
    expect(bookMock).not.toHaveBeenCalled();
  });
});
