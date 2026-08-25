import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type {
  BookResponse,
  BookingConfig,
  QuoteResponse,
  SearchResponse,
} from '../api/types';
import App from '../App';
import { BookingFlowProvider } from '../context/BookingFlowContext';
import { ConfigProvider } from '../context/ConfigContext';

const api = vi.hoisted(() => ({
  config: vi.fn(),
  search: vi.fn(),
  quote: vi.fn(),
  listServices: vi.fn(),
  book: vi.fn(),
  createRequestPaymentMethodSetup: vi.fn(),
  submitRequest: vi.fn(),
  getBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));

const stripe = vi.hoisted(() => ({ loadStripe: vi.fn() }));

vi.mock('../api/client', () => ({
  bookingApi: api,
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Something went wrong',
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: stripe.loadStripe,
}));

const ROOM_TYPE_ID = '11111111-1111-4111-8111-111111111111';
const RATE_PLAN_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';

const searchResponse: SearchResponse = {
  propertyId: '44444444-4444-4444-8444-444444444444',
  checkIn: '2026-10-10',
  checkOut: '2026-10-12',
  branding: { displayName: 'Hotel Vertical' },
  results: [{
    propertyName: 'Hotel Vertical',
    roomTypes: [{
      roomTypeId: ROOM_TYPE_ID,
      roomTypeName: 'Garden suite',
      rates: [{
        ratePlanId: RATE_PLAN_ID,
        ratePlanName: 'Flexible',
        totalAmount: 200,
        currencyCode: 'EUR',
      }],
    }],
  }],
};

const quote: QuoteResponse = {
  nights: 2,
  currencyCode: 'EUR',
  lineItems: [
    { date: '2026-10-10', rate: '100.00', tax: '0.00' },
    { date: '2026-10-11', rate: '100.00', tax: '0.00' },
  ],
  roomTotal: '200.00',
  taxTotal: '0.00',
  services: [],
  servicesTotal: '0.00',
  servicesTaxTotal: '0.00',
  grandTotal: '200.00',
  depositPolicy: { type: 'none', refundable: true },
  depositDue: '0.00',
  cancellationPolicy: {
    type: 'tiered',
    description: 'Free cancellation before arrival.',
    freeCancelHoursBeforeArrival: 24,
  },
};

function config(bookingMode: BookingConfig['bookingMode']): BookingConfig {
  return {
    isEnabled: true,
    displayName: 'Hotel Vertical',
    depositPolicy: { type: 'none', refundable: true },
    stripePublishableKey: null,
    sellableRoomTypeIds: [ROOM_TYPE_ID],
    sellableRatePlanIds: [RATE_PLAN_ID],
    bookingMode,
    paymentMethodCollection: 'disabled',
    formQuestions: bookingMode === 'request'
      ? [{
          id: QUESTION_ID,
          label: 'Purpose of stay',
          type: 'single_select',
          options: ['Leisure', 'Business'],
          order: 0,
          isActive: true,
          isRequired: true,
        }]
      : [],
  };
}

function renderWidget(bookingMode: BookingConfig['bookingMode']) {
  api.config.mockResolvedValue(config(bookingMode));
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <BookingFlowProvider>
            <App />
          </BookingFlowProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function selectQuotedStay() {
  await screen.findByRole('heading', { name: 'Find a room' });
  await userEvent.click(screen.getByRole('button', { name: 'Search availability' }));
  await screen.findByRole('heading', { name: 'Available rooms' });
  await userEvent.click(await screen.findByRole('button', { name: 'Select' }));
  await screen.findByRole('heading', { name: 'Garden suite' });
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Enhance your stay' });
}

describe('Booking widget request/instant rollout', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.search.mockResolvedValue(searchResponse);
    api.quote.mockResolvedValue(quote);
    api.listServices.mockResolvedValue({ propertyId: searchResponse.propertyId, data: [] });
    api.submitRequest.mockResolvedValue({
      requestId: '55555555-5555-4555-8555-555555555555',
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
    api.book.mockResolvedValue({
      success: true,
      confirmationNumber: 'HAIP-INSTANT-1',
      reservationId: '66666666-6666-4666-8666-666666666666',
      status: 'confirmed',
      currencyCode: 'EUR',
      grandTotal: '200.00',
      deposit: null,
      lineItems: quote.lineItems,
      cancellationPolicy: 'Free cancellation before arrival.',
    } satisfies BookResponse);
  });

  afterEach(() => {
    consoleError.mockRestore();
    cleanup();
  });

  it('submits the configured request flow without loading Stripe or exposing guest management', async () => {
    renderWidget('request');
    await selectQuotedStay();

    await userEvent.click(screen.getByRole('button', { name: 'Continue to your details' }));
    await screen.findByRole('heading', { name: 'Tell us about your stay' });
    await userEvent.type(screen.getByLabelText(/^First name/), 'Ada');
    await userEvent.type(screen.getByLabelText(/^Last name/), 'Lovelace');
    await userEvent.type(screen.getByLabelText(/^Email/), 'ada@example.com');
    await userEvent.selectOptions(screen.getByLabelText(/^Purpose of stay/), 'Leisure');
    await userEvent.click(screen.getByRole('button', { name: 'Submit booking request' }));

    expect(await screen.findByText('Request received · Pending review')).toBeVisible();
    expect(screen.getByText(/This is not a confirmed reservation/i)).toBeVisible();
    expect(screen.getByText(/You have not been charged/i)).toBeVisible();
    expect(screen.queryByRole('link', { name: /manage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/confirmation number/i)).not.toBeInTheDocument();

    expect(api.submitRequest).toHaveBeenCalledOnce();
    expect(api.submitRequest.mock.calls[0]![0]).toMatchObject({
      roomTypeId: ROOM_TYPE_ID,
      ratePlanId: RATE_PLAN_ID,
      guestFirstName: 'Ada',
      guestLastName: 'Lovelace',
      guestEmail: 'ada@example.com',
      applicationAnswers: { [QUESTION_ID]: 'Leisure' },
    });
    expect(api.submitRequest.mock.calls[0]![0]).not.toHaveProperty('setupIntentId');
    expect(api.createRequestPaymentMethodSetup).not.toHaveBeenCalled();
    expect(stripe.loadStripe).not.toHaveBeenCalled();
    expect(api.book).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Maximum update depth');
  });

  it('preserves the instant booking path when the property remains in instant mode', async () => {
    renderWidget('instant');
    await selectQuotedStay();

    await userEvent.click(screen.getByRole('button', { name: 'Continue to guest details' }));
    await screen.findByRole('heading', { name: 'Guest details' });
    await userEvent.type(screen.getByLabelText(/^First name/), 'Grace');
    await userEvent.type(screen.getByLabelText(/^Last name/), 'Hopper');
    await userEvent.type(screen.getByLabelText(/^Email/), 'grace@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByRole('heading', { name: 'Payment' });
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByText('Booking confirmed')).toBeVisible();
    expect(screen.getByText('HAIP-INSTANT-1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Manage this booking' })).toBeVisible();
    await waitFor(() => expect(api.book).toHaveBeenCalledOnce());
    expect(api.book.mock.calls[0]![0]).toMatchObject({
      roomTypeId: ROOM_TYPE_ID,
      ratePlanId: RATE_PLAN_ID,
      guestFirstName: 'Grace',
      guestLastName: 'Hopper',
      guestEmail: 'grace@example.com',
    });
    expect(api.submitRequest).not.toHaveBeenCalled();
    expect(api.createRequestPaymentMethodSetup).not.toHaveBeenCalled();
    expect(stripe.loadStripe).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Maximum update depth');
  });
});
