import { StrictMode, type CSSProperties } from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { BookingConfig, QuoteResponse, SearchRate, SearchRoomType } from '../api/types';
import { BookingFlowProvider, useBookingFlow } from '../context/BookingFlowContext';
import { ConfigProvider } from '../context/ConfigContext';
import { RequestPayment } from './RequestPayment';
import { RequestReceived } from './RequestReceived';
import { StripeSetupForm } from '../components/StripeSetupForm';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  createSetup: vi.fn(),
  submitRequest: vi.fn(),
  loadStripe: vi.fn(),
  confirmSetup: vi.fn(),
  elementsOptions: vi.fn(),
}));

vi.mock('../api/client', () => ({
  bookingApi: {
    config: mocks.config,
    createRequestPaymentMethodSetup: mocks.createSetup,
    submitRequest: mocks.submitRequest,
  },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Something went wrong',
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: mocks.loadStripe,
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({
    children,
    options,
  }: {
    children: React.ReactNode;
    options: unknown;
  }) => {
    mocks.elementsOptions(options);
    return <div>{children}</div>;
  },
  PaymentElement: () => <div aria-label="Secure card entry" />,
  useElements: () => ({ id: 'elements' }),
  useStripe: () => ({ confirmSetup: mocks.confirmSetup }),
}));

const ROOM_TYPE_ID = '11111111-1111-4111-8111-111111111111';
const RATE_PLAN_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const quote: QuoteResponse = {
  nights: 2,
  currencyCode: 'EUR',
  lineItems: [{ date: '2026-09-10', rate: '290.00', tax: '30.00' }],
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
  totalAmount: 640,
  currencyCode: 'EUR',
};

function config(policy: BookingConfig['paymentMethodCollection']): BookingConfig {
  return {
    isEnabled: true,
    displayName: 'Hotel Mirador',
    depositPolicy: { type: 'none', refundable: true },
    stripePublishableKey: 'pk_test_public',
    sellableRoomTypeIds: [ROOM_TYPE_ID],
    sellableRatePlanIds: [RATE_PLAN_ID],
    bookingMode: 'request',
    paymentMethodCollection: policy,
    formQuestions: [],
  };
}

function SeedPayment({ prepareRequestKey = false }: { prepareRequestKey?: boolean }) {
  const flow = useBookingFlow();
  const navigate = useNavigate();

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
        flow.setGuest({
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        });
        flow.setApplicationAnswers({ [QUESTION_ID]: '18:00' });
        if (prepareRequestKey) flow.ensureRequestIdempotencyKey();
        navigate('/request/payment');
      }}
    >
      Begin payment
    </button>
  );
}

function renderPayment(
  policy: BookingConfig['paymentMethodCollection'],
  widgetStyle?: CSSProperties,
  options: { strict?: boolean; prepareRequestKey?: boolean } = {},
) {
  mocks.config.mockResolvedValue(config(policy));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const application = (
    <div className="haip-booking" style={widgetStyle}>
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider>
            <BookingFlowProvider>
              <Routes>
                <Route
                  path="/"
                  element={<SeedPayment prepareRequestKey={options.prepareRequestKey} />}
                />
                <Route path="/request/payment" element={<RequestPayment />} />
                <Route path="/request/application" element={<p>Application page</p>} />
                <Route path="/request/received" element={<RequestReceived />} />
              </Routes>
            </BookingFlowProvider>
          </ConfigProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </div>
  );
  return render(options.strict ? <StrictMode>{application}</StrictMode> : application);
}

async function begin() {
  await userEvent.click(screen.getByRole('button', { name: 'Begin payment' }));
  await screen.findByRole('heading', { name: 'Secure your request' });
}

describe('RequestPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadStripe.mockResolvedValue({});
    mocks.createSetup.mockResolvedValue({
      setupIntentId: 'seti_server',
      clientSecret: 'seti_server_secret_value',
    });
    mocks.confirmSetup.mockResolvedValue({
      setupIntent: { id: 'seti_succeeded', status: 'succeeded' },
    });
    mocks.submitRequest.mockResolvedValue({
      requestId: 'request-123',
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
  });

  it('lets an optional card be explicitly skipped without loading Stripe', async () => {
    renderPayment('optional');
    await begin();

    expect(screen.getByRole('button', { name: 'Add a card' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue without a card' })).toBeVisible();
    expect(mocks.createSetup).not.toHaveBeenCalled();
    expect(mocks.loadStripe).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Secure card entry')).not.toBeInTheDocument();
    expect(screen.getByText(/If you add a card, it will be securely saved/i)).toBeVisible();
    expect(screen.queryByText(/^Your card will be securely saved/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Continue without a card' }));

    await waitFor(() => expect(mocks.submitRequest).toHaveBeenCalledOnce());
    const payload = mocks.submitRequest.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('setupIntentId');
    expect(payload).not.toHaveProperty('consentAccepted');
    expect(await screen.findByText('Request received · Pending review')).toBeVisible();
  });

  it('redirects disabled collection without loading Stripe or requesting a setup', async () => {
    renderPayment('disabled');
    await userEvent.click(screen.getByRole('button', { name: 'Begin payment' }));

    expect(await screen.findByText('Application page')).toBeVisible();
    expect(mocks.createSetup).not.toHaveBeenCalled();
    expect(mocks.loadStripe).not.toHaveBeenCalled();
    expect(mocks.submitRequest).not.toHaveBeenCalled();
  });

  it('loads the Payment Element only after an optional guest chooses to add a card', async () => {
    renderPayment('optional');
    await begin();

    await userEvent.click(screen.getByRole('button', { name: 'Add a card' }));

    await waitFor(() => expect(mocks.createSetup).toHaveBeenCalledOnce());
    expect(mocks.loadStripe).toHaveBeenCalledWith('pk_test_public');
    expect(await screen.findByLabelText('Secure card entry')).toBeVisible();
  });

  it.each([
    { policy: 'required' as const, chooseCard: false },
    { policy: 'optional' as const, chooseCard: true },
  ])(
    'finishes a deferred $policy setup when the routed payment tree replays in StrictMode',
    async ({ policy, chooseCard }) => {
      let resolveSetup!: (value: {
        setupIntentId: string;
        clientSecret: string;
      }) => void;
      mocks.createSetup.mockReturnValue(
        new Promise((resolve) => {
          resolveSetup = resolve;
        }),
      );
      renderPayment(policy, undefined, {
        strict: true,
        prepareRequestKey: true,
      });
      await begin();
      if (chooseCard) {
        await userEvent.click(screen.getByRole('button', { name: 'Add a card' }));
      }

      await waitFor(() => expect(mocks.createSetup).toHaveBeenCalledOnce());
      expect(screen.getByText('Preparing secure card entry…')).toBeVisible();
      const setupKey = mocks.createSetup.mock.calls[0]![0].idempotencyKey;

      resolveSetup({
        setupIntentId: 'seti_deferred',
        clientSecret: 'seti_deferred_secret_value',
      });

      expect(await screen.findByLabelText('Secure card entry')).toBeVisible();
      expect(screen.queryByText('Preparing secure card entry…')).not.toBeInTheDocument();
      expect(mocks.createSetup).toHaveBeenCalledOnce();
      expect(mocks.createSetup.mock.calls[0]![0].idempotencyKey).toBe(setupKey);
    },
  );

  it('surfaces a deferred setup error after the routed tree replays in StrictMode', async () => {
    let rejectSetup!: (error: Error) => void;
    mocks.createSetup.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSetup = reject;
      }),
    );
    renderPayment('required', undefined, {
      strict: true,
      prepareRequestKey: true,
    });
    await begin();
    await waitFor(() => expect(mocks.createSetup).toHaveBeenCalledOnce());

    rejectSetup(new Error('Secure card entry is unavailable.'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Secure card entry is unavailable.',
    );
    expect(screen.queryByText('Preparing secure card entry…')).not.toBeInTheDocument();
    expect(mocks.createSetup).toHaveBeenCalledOnce();
  });

  it('requires consent and a successful SetupIntent before required submission', async () => {
    renderPayment('required');
    await begin();

    expect(await screen.findByLabelText('Secure card entry')).toBeVisible();
    const submit = screen.getByRole('button', { name: 'Save card and submit booking request' });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/You will not be charged now/i)).toBeVisible();
    expect(screen.getByText(/charge amounts explicitly recorded against this stay/i)).toBeVisible();

    await userEvent.click(screen.getByRole('checkbox', { name: /I authorize Hotel Mirador/i }));
    await userEvent.click(submit);

    await waitFor(() => expect(mocks.confirmSetup).toHaveBeenCalledOnce());
    expect(mocks.confirmSetup).toHaveBeenCalledWith({
      elements: { id: 'elements' },
      redirect: 'if_required',
    });
    await waitFor(() => expect(mocks.submitRequest).toHaveBeenCalledOnce());
    const payload = mocks.submitRequest.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      setupIntentId: 'seti_succeeded',
      consentAccepted: true,
      consentVersion: 'request-card-v1',
    });
    expect(payload).not.toHaveProperty('paymentMethodId');
    expect(payload).not.toHaveProperty('cardBrand');
    expect(payload).not.toHaveProperty('cardLastFour');
  });

  it('blocks required submission when Stripe does not complete setup', async () => {
    mocks.confirmSetup.mockResolvedValue({
      error: { message: 'Your card could not be saved.' },
    });
    renderPayment('required');
    await begin();
    await screen.findByLabelText('Secure card entry');
    await userEvent.click(screen.getByRole('checkbox', { name: /I authorize Hotel Mirador/i }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Save card and submit booking request' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Your card could not be saved.');
    expect(mocks.submitRequest).not.toHaveBeenCalled();
  });

  it('ignores a late Stripe result after the guest navigates back', async () => {
    let resolveConfirmation!: (value: {
      setupIntent: { id: string; status: string };
    }) => void;
    mocks.confirmSetup.mockReturnValue(
      new Promise((resolve) => {
        resolveConfirmation = resolve;
      }),
    );
    renderPayment('required');
    await begin();
    await screen.findByLabelText('Secure card entry');
    await userEvent.click(screen.getByRole('checkbox', { name: /I authorize Hotel Mirador/i }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Save card and submit booking request' }),
    );

    await userEvent.click(screen.getByRole('button', { name: /Back to your details/ }));
    expect(await screen.findByText('Application page')).toBeVisible();
    resolveConfirmation({
      setupIntent: { id: 'seti_late', status: 'succeeded' },
    });

    await waitFor(() => expect(mocks.confirmSetup).toHaveBeenCalledOnce());
    expect(mocks.submitRequest).not.toHaveBeenCalled();
    expect(screen.getByText('Application page')).toBeVisible();
  });

  it('shows setup and submission server errors without navigating or double submitting', async () => {
    mocks.createSetup.mockRejectedValueOnce(new Error('Card setup is unavailable.'));
    renderPayment('required');
    await begin();

    expect(await screen.findByRole('alert')).toHaveTextContent('Card setup is unavailable.');
    expect(mocks.submitRequest).not.toHaveBeenCalled();
  });

  it('offers setup retry and optional skip after adding a card fails', async () => {
    mocks.createSetup
      .mockRejectedValueOnce(new Error('Card setup is unavailable.'))
      .mockResolvedValueOnce({
        setupIntentId: 'seti_retry',
        clientSecret: 'seti_retry_secret_value',
      });
    renderPayment('optional');
    await begin();
    await userEvent.click(screen.getByRole('button', { name: 'Add a card' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Card setup is unavailable.');
    expect(screen.getByRole('button', { name: 'Retry secure card entry' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue without a card' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Retry secure card entry' }));

    await waitFor(() => expect(mocks.createSetup).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Secure card entry')).toBeVisible();
  });

  it('keeps retry and optional skip available after Stripe rejects the card setup', async () => {
    mocks.confirmSetup.mockResolvedValueOnce({
      error: { message: 'Stripe could not save this card.' },
    });
    renderPayment('optional');
    await begin();
    await userEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    await screen.findByLabelText('Secure card entry');
    await userEvent.click(screen.getByRole('checkbox', { name: /I authorize Hotel Mirador/i }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Save card and submit booking request' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stripe could not save this card.',
    );
    expect(
      screen.getByRole('button', { name: 'Retry saving card and submit request' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue without a card' })).toBeEnabled();
  });

  it('prevents a double submission and re-enables controls after a real POST failure', async () => {
    let rejectRequest!: (error: Error) => void;
    mocks.submitRequest.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    renderPayment('optional');
    await begin();

    const skip = screen.getByRole('button', { name: 'Continue without a card' });
    await userEvent.dblClick(skip);
    await waitFor(() => expect(mocks.submitRequest).toHaveBeenCalledOnce());
    expect(skip).toBeDisabled();
    expect(screen.getByRole('button', { name: /Back to your details/ })).toBeDisabled();

    rejectRequest(new Error('The request could not be submitted.'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request could not be submitted.',
    );
    expect(screen.getByRole('button', { name: /Back to your details/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue without a card' })).toBeEnabled();
  });

  it('derives Stripe appearance from effective widget theme variables', async () => {
    renderPayment('required', {
      '--haip-primary': '#126E75',
      '--haip-text': '#102A43',
      '--haip-surface': '#FAFCFE',
      '--haip-radius': '14px',
    } as CSSProperties);
    await begin();
    await screen.findByLabelText('Secure card entry');

    expect(mocks.elementsOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: {
          variables: expect.objectContaining({
            colorPrimary: '#126E75',
            colorText: '#102A43',
            colorBackground: '#FAFCFE',
            borderRadius: '14px',
          }),
        },
      }),
    );
  });

  it('completes Stripe setup exactly once when effects replay in StrictMode', async () => {
    const onConfirmed = vi.fn();
    render(
      <StrictMode>
        <StripeSetupForm
          propertyName="Hotel Mirador"
          submitting={false}
          onConfirmed={onConfirmed}
        />
      </StrictMode>,
    );

    await userEvent.click(
      screen.getByRole('checkbox', { name: /I authorize Hotel Mirador/i }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save card and submit booking request' }),
    );

    await waitFor(() =>
      expect(onConfirmed).toHaveBeenCalledOnce(),
    );
    expect(onConfirmed).toHaveBeenCalledWith(
      'seti_succeeded',
      expect.stringContaining('I authorize Hotel Mirador'),
    );
    expect(
      screen.getByRole('button', { name: 'Save card and submit booking request' }),
    ).toBeEnabled();
  });
});
