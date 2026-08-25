import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type {
  BookingConfig,
  BookingFormQuestion,
  QuoteResponse,
  SearchRate,
  SearchRoomType,
} from '../api/types';
import { Layout } from '../components/Layout';
import {
  BookingFlowProvider,
  useBookingFlow,
} from '../context/BookingFlowContext';
import { ConfigProvider } from '../context/ConfigContext';
import { GuestDetails } from './GuestDetails';
import { Payment } from './Payment';
import { Confirmation } from './Confirmation';
import { RequestApplication } from './RequestApplication';
import { RequestPayment } from './RequestPayment';
import { RequestReceived } from './RequestReceived';

const api = vi.hoisted(() => ({
  config: vi.fn(),
  createRequestPaymentMethodSetup: vi.fn(),
  submitRequest: vi.fn(),
  book: vi.fn(),
}));

vi.mock('../api/client', () => ({
  bookingApi: api,
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Something went wrong',
}));

const ROOM_TYPE_ID = '11111111-1111-4111-8111-111111111111';
const RATE_PLAN_ID = '22222222-2222-4222-8222-222222222222';

const questions: BookingFormQuestion[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    label: 'Expected arrival time',
    type: 'short_text',
    order: 0,
    isActive: true,
    isRequired: true,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    label: 'Tell us about your stay',
    type: 'long_text',
    order: 1,
    isActive: true,
    isRequired: false,
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    label: 'Purpose of stay',
    type: 'single_select',
    options: ['Leisure', 'Business'],
    order: 2,
    isActive: true,
    isRequired: true,
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    label: 'Interested experiences',
    type: 'multi_select',
    options: ['Spa', 'Dining'],
    order: 3,
    isActive: true,
    isRequired: false,
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    label: 'Travelling with a pet',
    type: 'yes_no',
    order: 4,
    isActive: true,
    isRequired: true,
  },
  {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    label: 'Celebration date',
    type: 'date',
    order: 5,
    isActive: true,
    isRequired: false,
  },
];

const quote: QuoteResponse = {
  nights: 2,
  currencyCode: 'EUR',
  lineItems: [
    { date: '2026-09-10', rate: '290.00', tax: '30.00' },
    { date: '2026-09-11', rate: '290.00', tax: '30.00' },
  ],
  roomTotal: '580.00',
  taxTotal: '60.00',
  grandTotal: '640.00',
  depositPolicy: { type: 'none', refundable: true },
  depositDue: '0.00',
};

const roomType: SearchRoomType = {
  roomTypeId: ROOM_TYPE_ID,
  roomTypeName: 'Deluxe room',
};

const rate: SearchRate = {
  ratePlanId: RATE_PLAN_ID,
  ratePlanName: 'Flexible rate',
  totalAmount: 640,
  currencyCode: 'EUR',
};

function requestConfig(
  paymentMethodCollection: BookingConfig['paymentMethodCollection'] = 'required',
  formQuestions = questions,
): BookingConfig {
  return {
    isEnabled: true,
    displayName: 'Hotel Mirador',
    primaryColor: '#0D9488',
    accentColor: '#183153',
    depositPolicy: { type: 'none', refundable: true },
    stripePublishableKey: 'pk_test_public',
    sellableRoomTypeIds: [ROOM_TYPE_ID],
    sellableRatePlanIds: [RATE_PLAN_ID],
    bookingMode: 'request',
    paymentMethodCollection,
    formQuestions,
  };
}

function SeedFlow({
  target,
  withStoredApplication = false,
}: {
  target: string;
  withStoredApplication?: boolean;
}) {
  const navigate = useNavigate();
  const flow = useBookingFlow();

  return (
    <button
      onClick={() => {
        flow.setCriteria({
          checkIn: '2026-09-10',
          checkOut: '2026-09-12',
          adults: 2,
          children: 0,
        });
        flow.setSelection(roomType, rate);
        flow.setQuote(quote);
        if (withStoredApplication) {
          flow.setGuest({
            firstName: 'Stored',
            lastName: 'Guest',
            email: 'stored@example.com',
          });
          flow.setApplicationAnswers({
            [questions[0]!.id]: 'Stored answer',
            [questions[2]!.id]: 'Leisure',
            [questions[4]!.id]: false,
          });
        }
        navigate(target);
      }}
    >
      Begin test flow
    </button>
  );
}

function StoredState() {
  const { guest, applicationAnswers } = useBookingFlow();
  return <output>{JSON.stringify({ guest, applicationAnswers })}</output>;
}

function renderRequestApplication(
  config = requestConfig(),
  options: { withStoredApplication?: boolean; receiptInLayout?: boolean } = {},
) {
  api.config.mockResolvedValue(config);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <BookingFlowProvider>
            <Routes>
              <Route
                path="/"
                element={
                  <SeedFlow
                    target="/request/application"
                    withStoredApplication={options.withStoredApplication}
                  />
                }
              />
              <Route path="/extras" element={<StoredState />} />
              <Route path="/request/application" element={<RequestApplication />} />
              <Route path="/request/payment" element={<RequestPayment />} />
              <Route
                path="/request/received"
                element={
                  options.receiptInLayout ? (
                    <Layout>
                      <RequestReceived />
                    </Layout>
                  ) : (
                    <RequestReceived />
                  )
                }
              />
            </Routes>
          </BookingFlowProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function begin() {
  await userEvent.click(screen.getByRole('button', { name: 'Begin test flow' }));
  await screen.findByRole('heading', { name: 'Tell us about your stay' });
}

async function fillCoreGuest() {
  await userEvent.type(screen.getByLabelText(/^First name/), 'Ada');
  await userEvent.type(screen.getByLabelText(/^Last name/), 'Lovelace');
  await userEvent.type(screen.getByLabelText(/^Email/), 'ada@example.com');
}

describe('RequestApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.submitRequest.mockResolvedValue({
      requestId: 'request-123',
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
  });

  it('renders the six configured question types as accessible controls', async () => {
    renderRequestApplication();
    await begin();

    expect(screen.getByRole('textbox', { name: /Expected arrival time/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Tell us about your stay/ })).toBeVisible();
    expect(screen.getByRole('combobox', { name: /Purpose of stay/ })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Spa' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Dining' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'No' })).toBeVisible();
    expect(screen.getByLabelText(/Celebration date/)).toHaveAttribute('type', 'date');
  });

  it('reports configured required questions before advancing', async () => {
    renderRequestApplication();
    await begin();
    await fillCoreGuest();

    fireEvent.submit(screen.getByRole('form', { name: 'Booking request application' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Expected arrival time is required');
    expect(screen.getByRole('heading', { name: 'Tell us about your stay' })).toBeVisible();
  });

  it('does not commit local edits when the guest navigates back', async () => {
    renderRequestApplication(requestConfig(), { withStoredApplication: true });
    await begin();

    await userEvent.clear(screen.getByLabelText(/^First name/));
    await userEvent.type(screen.getByLabelText(/^First name/), 'Changed');
    await userEvent.clear(screen.getByLabelText(/Expected arrival time/));
    await userEvent.type(screen.getByLabelText(/Expected arrival time/), 'Changed answer');
    await userEvent.click(screen.getByRole('button', { name: /Back to extras/ }));

    const state = screen.getByRole('status');
    expect(state).toHaveTextContent('Stored');
    expect(state).toHaveTextContent('Stored answer');
    expect(state).not.toHaveTextContent('Changed');
  });

  it('submits directly without Stripe when card collection is disabled', async () => {
    const onlyQuestion = [{ ...questions[0]!, isRequired: true }];
    renderRequestApplication(requestConfig('disabled', onlyQuestion), {
      receiptInLayout: true,
    });
    await begin();
    await fillCoreGuest();
    await userEvent.type(screen.getByLabelText(/Expected arrival time/), '18:00');
    await userEvent.click(screen.getByRole('button', { name: 'Submit booking request' }));

    await waitFor(() => expect(api.submitRequest).toHaveBeenCalledOnce());
    const payload = api.submitRequest.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      roomTypeId: ROOM_TYPE_ID,
      ratePlanId: RATE_PLAN_ID,
      guestFirstName: 'Ada',
      guestEmail: 'ada@example.com',
      applicationAnswers: { [questions[0]!.id]: '18:00' },
    });
    expect(payload).not.toHaveProperty('setupIntentId');
    expect(payload).not.toHaveProperty('paymentMethodId');
    expect(payload).not.toHaveProperty('cardLastFour');
    expect(api.createRequestPaymentMethodSetup).not.toHaveBeenCalled();

    expect(await screen.findByText('Request received · Pending review')).toBeVisible();
    expect(screen.getByText(/email/i)).toBeVisible();
    expect(screen.queryByText(/booking confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /manage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('shows a server failure and allows a safe retry with the same submission key', async () => {
    api.submitRequest
      .mockRejectedValueOnce(new Error('The selected stay is no longer available.'))
      .mockResolvedValueOnce({
        requestId: 'request-123',
        status: 'pending',
        message: 'Pending review.',
      });
    const onlyQuestion = [{ ...questions[0]!, isRequired: true }];
    renderRequestApplication(requestConfig('disabled', onlyQuestion));
    await begin();
    await fillCoreGuest();
    await userEvent.type(screen.getByLabelText(/Expected arrival time/), '18:00');

    await userEvent.click(screen.getByRole('button', { name: 'Submit booking request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The selected stay is no longer available.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Submit booking request' }));

    await waitFor(() => expect(api.submitRequest).toHaveBeenCalledTimes(2));
    expect(api.submitRequest.mock.calls[0]![0].idempotencyKey).toBe(
      api.submitRequest.mock.calls[1]![0].idempotencyKey,
    );
  });
});

describe('instant booking regression', () => {
  it('keeps the existing guest, payment, booking client, and confirmation path', async () => {
    vi.clearAllMocks();
    api.config.mockResolvedValue({
      ...requestConfig('disabled', []),
      bookingMode: 'instant',
    });
    api.book.mockResolvedValue({
      success: true,
      confirmationNumber: 'HAIP-12345678',
      reservationId: 'reservation-123',
      status: 'confirmed',
      currencyCode: 'EUR',
      grandTotal: '640.00',
      deposit: null,
      lineItems: quote.lineItems,
      cancellationPolicy: 'Flexible',
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider>
            <BookingFlowProvider>
              <Routes>
                <Route path="/" element={<SeedFlow target="/guest" />} />
                <Route path="/guest" element={<GuestDetails />} />
                <Route path="/payment" element={<Payment />} />
                <Route path="/confirmation" element={<Confirmation />} />
              </Routes>
            </BookingFlowProvider>
          </ConfigProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Begin test flow' }));
    await fillCoreGuest();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));

    await waitFor(() => expect(api.book).toHaveBeenCalledOnce());
    expect(await screen.findByText('Booking confirmed')).toBeVisible();
    expect(screen.getByText('HAIP-12345678')).toBeVisible();
    expect(api.submitRequest).not.toHaveBeenCalled();
  });
});
