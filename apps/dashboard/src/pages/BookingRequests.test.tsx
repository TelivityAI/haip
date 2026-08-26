import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/Toast';
import BookingRequests from './BookingRequests';
import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import hr from '../locales/hr.json';
import itMessages from '../locales/it.json';
import ptBR from '../locales/pt-BR.json';
import srLatn from '../locales/sr-Latn.json';

const context = vi.hoisted(() => ({
  propertyId: 'property-1' as string | null,
  read: true,
  write: true,
}));

vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({
    propertyId: context.propertyId,
    currencyCode: 'EUR',
    isPortfolioMode: false,
  }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      permission === 'reservations.read' ? context.read : context.write,
  }),
}));

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '../lib/api';

const REQUEST_ID = 'request-1';
const PAYMENT_ID = 'payment-1';
const EXTERNAL_PAYMENT_ID = 'payment-2';

const requestListItem = {
  id: REQUEST_ID,
  propertyId: 'property-1',
  status: 'pending',
  arrivalDate: '2026-09-10',
  departureDate: '2026-09-12',
  roomTypeId: 'room-type-1',
  ratePlanId: 'rate-plan-1',
  adults: 2,
  children: 0,
  guestFirstName: 'Ada',
  guestLastName: 'Lovelace',
  guestEmail: 'ada@example.com',
  hasCard: true,
  acceptedPriceSource: null,
  acceptedTotal: null,
  submittedTotal: '640.00',
  currencyCode: 'EUR',
  acceptedReservationId: null,
  createdAt: '2026-08-24T10:00:00.000Z',
  updatedAt: '2026-08-24T10:00:00.000Z',
};

const requestDetail = {
  ...requestListItem,
  guestPhone: '+34 600 000 000',
  specialRequests: 'A quiet room, please.',
  serviceIds: [],
  formSnapshot: [
    {
      id: 'question-1',
      label: 'Expected arrival time',
      type: 'short_text',
      order: 0,
      isActive: true,
      isRequired: true,
    },
  ],
  applicationAnswers: { 'question-1': 'After 18:00' },
  submittedQuoteSnapshot: {
    currencyCode: 'EUR',
    grandTotal: '640.00',
    roomTotal: '580.00',
    taxTotal: '60.00',
    lineItems: [],
  },
  currentQuoteSnapshot: {
    currencyCode: 'EUR',
    grandTotal: '670.00',
    roomTotal: '610.00',
    taxTotal: '60.00',
    lineItems: [],
  },
  currencyCode: 'EUR',
  card: { brand: 'visa', lastFour: '4242' },
  customPriceReason: null,
  acceptedFolioId: null,
  decidedBy: null,
  decidedAt: null,
  denialReason: null,
  operationalReservation: null,
};

const stripePayment = {
  id: PAYMENT_ID,
  propertyId: 'property-1',
  bookingRequestId: REQUEST_ID,
  folioId: null,
  method: 'credit_card',
  status: 'captured',
  amount: '192.00',
  netCapturedAmount: '192.00',
  allocatedAmount: '50.00',
  reservedResolutionAmount: '0.00',
  availableToAllocate: '142.00',
  availableToResolve: '192.00',
  unresolvedAmount: '192.00',
  returnedAmount: '0.00',
  retainedAmount: '0.00',
  availableAmount: '142.00',
  currencyCode: 'EUR',
  source: 'saved_card',
  gatewayProvider: 'stripe',
  reference: null,
  cardLastFour: '4242',
  cardBrand: 'visa',
  originalPaymentId: null,
  notes: 'Staff-initiated Booking Request saved-card charge captured',
  processedAt: '2026-08-25T09:00:00.000Z',
  createdAt: '2026-08-25T09:00:00.000Z',
  updatedAt: '2026-08-25T09:00:00.000Z',
};

const externalPayment = {
  ...stripePayment,
  id: EXTERNAL_PAYMENT_ID,
  method: 'bank_transfer',
  amount: '100.00',
  netCapturedAmount: '100.00',
  allocatedAmount: '0.00',
  reservedResolutionAmount: '0.00',
  availableToAllocate: '100.00',
  availableToResolve: '100.00',
  unresolvedAmount: '100.00',
  returnedAmount: '0.00',
  retainedAmount: '0.00',
  availableAmount: '100.00',
  source: 'external',
  gatewayProvider: 'stripe',
  reference: 'BANK-42',
  cardLastFour: null,
  cardBrand: null,
  notes: 'Deposit received',
};

const paymentsEmpty = { movements: [], allocations: [], resolutions: [] };

function mockApi(overrides?: {
  list?: unknown;
  detail?: unknown;
  payments?: unknown;
  installments?: unknown;
  emails?: unknown;
  folio?: unknown | (() => unknown);
  preview?: unknown;
  amendmentPreview?: unknown;
  audit?: unknown | ((cursor: string | null) => unknown);
}) {
  vi.mocked(api.get).mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/v1/booking-requests') {
      return Promise.resolve({
        data: overrides?.list ?? {
          data: [requestListItem],
          total: 1,
          page: 1,
          limit: 20,
          hasMore: false,
        },
      } as never);
    }
    if (url === `/v1/booking-requests/${REQUEST_ID}`) {
      return Promise.resolve({ data: overrides?.detail ?? requestDetail } as never);
    }
    if (url === `/v1/booking-requests/${REQUEST_ID}/acceptance-preview`) {
      return Promise.resolve({ data: overrides?.preview ?? {
        requestId: REQUEST_ID,
        submittedTotal: '640.00',
        currentTotal: '670.00',
        currencyCode: 'EUR',
        previewVersion: 1,
        previewToken: 'v1:preview-token',
      } } as never);
    }
    if (url === `/v1/booking-requests/${REQUEST_ID}/stay-amendment-preview`) {
      return Promise.resolve({ data: overrides?.amendmentPreview ?? {
        requestId: REQUEST_ID,
        reservationId: 'reservation-1',
        previousArrivalDate: '2026-09-10',
        previousDepartureDate: '2026-09-12',
        previousTotal: '640.00',
        arrivalDate: String(config?.params?.arrivalDate ?? '2026-09-10'),
        departureDate: String(config?.params?.departureDate ?? '2026-09-13'),
        priorTotal: '960.00',
        currentTotal: '990.00',
        currencyCode: 'EUR',
        previewVersion: 1,
        previewToken: `v1:${'a'.repeat(64)}`,
      } } as never);
    }
    if (url === `/v1/booking-requests/${REQUEST_ID}/audit-history`) {
      const audit = typeof overrides?.audit === 'function'
        ? overrides.audit(typeof config?.params?.cursor === 'string' ? config.params.cursor : null)
        : overrides?.audit ?? [];
      return Promise.resolve({
        data: Array.isArray(audit) ? { data: audit, nextCursor: null } : audit,
      } as never);
    }
    if (url === `/v1/booking-requests/${REQUEST_ID}/payments`) {
      if (overrides?.payments instanceof Error) return Promise.reject(overrides.payments);
      return Promise.resolve({ data: overrides?.payments ?? paymentsEmpty } as never);
    }
    if (url === `/v1/booking-requests/${REQUEST_ID}/installments`) {
      return Promise.resolve({ data: overrides?.installments ?? [] } as never);
    }
    if (url === `/v1/booking-requests/${REQUEST_ID}/emails`) {
      return Promise.resolve({ data: overrides?.emails ?? [] } as never);
    }
    if (url === '/v1/folios/folio-1') {
      const folio = typeof overrides?.folio === 'function'
        ? overrides.folio()
        : overrides?.folio ?? {};
      return Promise.resolve({ data: folio } as never);
    }
    return Promise.resolve({ data: [] } as never);
  });
}

function renderAt(path = '/booking-requests') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Routes>
            <Route path="/booking-requests/*" element={<BookingRequests />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, queryClient };
}

describe('Booking request queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.propertyId = 'property-1';
    context.read = true;
    context.write = true;
    mockApi();
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: {} } as never);
    vi.mocked(api.delete).mockResolvedValue({ data: {} } as never);
  });

  it('uses the safe list amount without N+1 detail reads and sends queue filters', async () => {
    renderAt();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Booking requests' })).getByText('Pending')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Booking requests' })).getByText('Card saved')).toBeInTheDocument();
    expect(screen.getByText('€640.00')).toBeInTheDocument();

    const listCall = vi.mocked(api.get).mock.calls.find(([url]) => url === '/v1/booking-requests');
    expect(listCall?.[1]).toEqual({
      params: expect.objectContaining({ propertyId: 'property-1', page: 1, limit: 20 }),
    });
    expect(vi.mocked(api.get).mock.calls.filter(([url]) =>
      url === `/v1/booking-requests/${REQUEST_ID}`)).toHaveLength(0);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'accepted');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Guest' }), 'Ada');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Card' }), 'true');

    await waitFor(() => {
      const latest = vi.mocked(api.get).mock.calls
        .filter(([url]) => url === '/v1/booking-requests')
        .at(-1)?.[1];
      expect(latest).toEqual({
        params: expect.objectContaining({
          propertyId: 'property-1',
          status: 'accepted',
          guest: 'Ada',
          hasCard: true,
        }),
      });
    });
  });

  it('sorts the compact queue and opens the dedicated detail route', async () => {
    renderAt();
    await screen.findByText('Ada Lovelace');
    expect(screen.getByRole('table', { name: 'Booking requests' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'amount_desc');
    await waitFor(() => expect(vi.mocked(api.get).mock.calls
      .filter(([url]) => url === '/v1/booking-requests')
      .at(-1)?.[1]).toEqual({
      params: expect.objectContaining({
        propertyId: 'property-1',
        sortBy: 'requestedTotal',
        sortOrder: 'desc',
      }),
    }));
    await userEvent.click(screen.getByRole('link', { name: /Ada Lovelace/i }));
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('filters cross-property rows and treats a mismatched detail as not found', async () => {
    mockApi({ list: { data: [{ ...requestListItem, propertyId: 'property-2' }], total: 1 } });
    const queue = renderAt();
    expect(await screen.findByText('No booking requests match these filters.')).toBeInTheDocument();
    queue.unmount();

    vi.clearAllMocks();
    mockApi({ detail: { ...requestDetail, propertyId: 'property-2' } });
    renderAt(`/booking-requests/${REQUEST_ID}`);
    expect(await screen.findByRole('heading', { name: 'Request not found' })).toBeInTheDocument();
    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument();
  });

  it('does not query or render request data without reservations.read', () => {
    context.read = false;
    renderAt();
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('Booking request decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.propertyId = 'property-1';
    context.read = true;
    context.write = true;
    mockApi();
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
  });

  it('supports arrow-key navigation across the horizontally scrollable tabs', async () => {
    renderAt(`/booking-requests/${REQUEST_ID}`);
    const overview = await screen.findByRole('tab', { name: 'Overview' });
    overview.focus();
    await userEvent.keyboard('{ArrowRight}');

    const payments = screen.getByRole('tab', { name: 'Payments & plan' });
    expect(payments).toHaveFocus();
    expect(payments).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps decision and money actions independent and gates all writes', async () => {
    context.write = false;
    renderAt(`/booking-requests/${REQUEST_ID}`);
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny request' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Payments & plan' }));
    expect(screen.queryByRole('button', { name: 'Charge saved card' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record external payment' })).not.toBeInTheDocument();
    expect(screen.getByText('Booking decisions do not depend on payment state.')).toBeInTheDocument();
  });

  it('compares submitted/current amounts and requires a positive custom total and reason', async () => {
    const { queryClient } = renderAt(`/booking-requests/${REQUEST_ID}`);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: 'Accept request' }));

    const dialog = screen.getByRole('dialog', { name: 'Accept booking request' });
    expect(within(dialog).getByText('€640.00')).toBeInTheDocument();
    expect(within(dialog).getByText('€670.00')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Custom total/i }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Custom total' }), '0');
    expect(within(dialog).getByText('Enter an amount greater than zero.')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Custom total' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Custom total' }), 'abc');
    expect(within(dialog).getByText('Enter a valid decimal amount.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Custom total' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Custom total' }), '625.555');
    expect(within(dialog).getByText('Use only the minor units supported by this currency.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Custom total' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Custom total' }), '625');
    expect(within(dialog).getByRole('button', { name: 'Accept request' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason for custom total' }), 'Written offer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept request' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/accept`,
      {
        priceSource: 'custom',
        customTotal: '625.00',
        customReason: 'Written offer',
        previewToken: 'v1:preview-token',
      },
      { params: { propertyId: 'property-1' } },
    ));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['booking-request-messages', 'property-1', REQUEST_ID],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['booking-request-audit', 'property-1', REQUEST_ID],
    });
  });

  it('disables duplicate acceptance and preserves the modal draft on a server conflict', async () => {
    let rejectRequest!: (error: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }) as never);
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept request' }));
    const dialog = screen.getByRole('dialog', { name: 'Accept booking request' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /Custom total/i }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Custom total' }), '625');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason for custom total' }), 'Keep this draft');
    const submit = within(dialog).getByRole('button', { name: 'Accept request' });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1);

    rejectRequest({ response: { status: 409, data: { message: 'Stay is no longer available' } } });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stay is no longer available');
    expect(within(dialog).getByRole('textbox', { name: 'Custom total' })).toHaveValue('625');
    expect(within(dialog).getByRole('textbox', { name: 'Reason for custom total' })).toHaveValue('Keep this draft');
  });

  it('blocks denial while money is unresolved and directs staff to resolution actions', async () => {
    mockApi({ payments: { movements: [stripePayment], allocations: [], resolutions: [] } });
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Deny request' }));
    const dialog = screen.getByRole('dialog', { name: 'Deny booking request' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('€192.00 remains unresolved');
    expect(within(dialog).getByRole('button', { name: 'Confirm denial' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve money first' }));
    expect(screen.getByRole('tab', { name: 'Payments & plan' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Refund' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retain with reason' })).toBeInTheDocument();
  });

  it('uses authoritative net, reserved, allocation, and unresolved fields for every staff amount', async () => {
    const parent = {
      ...stripePayment,
      amount: '100.00',
      netCapturedAmount: '60.00',
      allocatedAmount: '5.00',
      reservedResolutionAmount: '20.00',
      availableToAllocate: '25.00',
      availableToResolve: '30.00',
      unresolvedAmount: '50.00',
      returnedAmount: '40.00',
      retainedAmount: '10.00',
      availableAmount: '25.00',
    };
    const child = {
      ...stripePayment,
      id: 'payment-child-return',
      amount: '-40.00',
      netCapturedAmount: '0.00',
      allocatedAmount: '0.00',
      reservedResolutionAmount: '0.00',
      availableToAllocate: '0.00',
      availableToResolve: '0.00',
      unresolvedAmount: '0.00',
      returnedAmount: '0.00',
      retainedAmount: '0.00',
      availableAmount: '0.00',
      originalPaymentId: PAYMENT_ID,
    };
    mockApi({
      payments: {
        movements: [parent, child],
        allocations: [],
        resolutions: [{
          id: 'resolution-pending',
          propertyId: 'property-1',
          bookingRequestId: REQUEST_ID,
          paymentId: PAYMENT_ID,
          type: 'refund',
          status: 'pending',
          amount: '20.00',
        }],
      },
    });
    renderAt(`/booking-requests/${REQUEST_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Deny request' }));
    const denial = screen.getByRole('dialog', { name: 'Deny booking request' });
    expect(within(denial).getByRole('alert')).toHaveTextContent('€50.00 remains unresolved');
    await userEvent.click(within(denial).getByRole('button', { name: 'Resolve money first' }));

    expect(await screen.findByText('Request money summary')).toBeInTheDocument();
    expect(screen.getByText('€60.00')).toBeInTheDocument();
    expect(screen.getByText('€40.00')).toBeInTheDocument();
    expect(screen.getByText('€10.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refund' }));
    expect(within(screen.getByRole('dialog', { name: 'Refund saved-card payment' }))
      .getByRole('textbox', { name: 'Amount' })).toHaveValue('30');
  });

  it('keeps legacy refunded parents visible without offering a zero-value resolution', async () => {
    mockApi({
      payments: {
        movements: [{
          ...stripePayment,
          status: 'refunded',
          amount: '100.00',
          netCapturedAmount: '0.00',
          allocatedAmount: '0.00',
          reservedResolutionAmount: '0.00',
          availableToAllocate: '0.00',
          availableToResolve: '0.00',
          unresolvedAmount: '0.00',
          returnedAmount: '100.00',
          retainedAmount: '0.00',
          availableAmount: '0.00',
        }],
        allocations: [],
        resolutions: [],
      },
    });
    renderAt(`/booking-requests/${REQUEST_ID}`);

    await userEvent.click(await screen.findByRole('tab', { name: 'Payments & plan' }));

    const summary = (await screen.findByText('Request money summary')).closest('section');
    expect(summary).not.toBeNull();
    expect(within(summary!).getByText('€100.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retain with reason' })).not.toBeInTheDocument();
  });

  it('offers the exact authoritative remainder for an inconsistent legacy refunded parent', async () => {
    mockApi({
      payments: {
        movements: [{
          ...stripePayment,
          status: 'refunded',
          amount: '100.00',
          netCapturedAmount: '25.00',
          allocatedAmount: '0.00',
          reservedResolutionAmount: '0.00',
          availableToAllocate: '25.00',
          availableToResolve: '25.00',
          unresolvedAmount: '25.00',
          returnedAmount: '75.00',
          retainedAmount: '0.00',
          availableAmount: '25.00',
        }],
        allocations: [],
        resolutions: [],
      },
    });
    renderAt(`/booking-requests/${REQUEST_ID}`);

    await userEvent.click(await screen.findByRole('tab', { name: 'Payments & plan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Refund' }));

    expect(within(screen.getByRole('dialog', { name: 'Refund saved-card payment' }))
      .getByRole('textbox', { name: 'Amount' })).toHaveValue('25');
  });

  it('never enables denial when the authoritative money state failed to load', async () => {
    mockApi({ payments: new Error('network unavailable') });
    renderAt(`/booking-requests/${REQUEST_ID}`);

    const deny = await screen.findByRole('button', { name: 'Deny request' });
    expect(deny).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payment state could not be verified. Denial remains blocked.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry payment state' }));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) =>
      url === `/v1/booking-requests/${REQUEST_ID}/payments`).length).toBeGreaterThan(1));
  });
});

describe('Accepted Booking Request stay amendments', () => {
  const acceptedDetail = {
    ...requestDetail,
    status: 'accepted' as const,
    acceptedPriceSource: 'current' as const,
    acceptedTotal: '640.00',
    acceptedReservationId: 'reservation-1',
    acceptedFolioId: 'folio-1',
    decidedAt: '2026-08-24T10:10:00.000Z',
    operationalReservation: {
      id: 'reservation-1',
      arrivalDate: '2026-09-10',
      departureDate: '2026-09-12',
      totalAmount: '660.00',
      currencyCode: 'EUR',
      roomTypeId: 'room-type-1',
      ratePlanId: 'rate-plan-1',
      status: 'confirmed',
      updatedAt: '2026-08-25T10:00:00.000Z',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    context.propertyId = 'property-1';
    context.read = true;
    context.write = true;
    mockApi({ detail: acceptedDetail });
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
  });

  it('previews old/new dates and all rate bases, then submits a reasoned custom amendment', async () => {
    const { queryClient } = renderAt(`/booking-requests/${REQUEST_ID}`);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    expect(await screen.findByText('Active stay')).toBeInTheDocument();
    expect(screen.getByText('€660.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Modify stay' }));

    const dialog = screen.getByRole('dialog', { name: 'Modify accepted stay' });
    const departure = within(dialog).getByLabelText('Departure date');
    await userEvent.clear(departure);
    await userEvent.type(departure, '2026-09-13');
    expect((await within(dialog).findAllByText('€960.00')).length).toBeGreaterThan(0);
    expect(within(dialog).getByText('€990.00')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('radio', { name: /Custom total/i }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Custom total' }), '975');
    expect(within(dialog).getByRole('button', { name: 'Apply stay change' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason for custom total' }), 'Loyalty adjustment');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply stay change' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/stay-amendments`,
      expect.objectContaining({
        arrivalDate: '2026-09-10',
        departureDate: '2026-09-13',
        priceSource: 'custom',
        customTotal: '975.00',
        customReason: 'Loyalty adjustment',
        previewToken: `v1:${'a'.repeat(64)}`,
        idempotencyKey: expect.any(String),
      }),
      { params: { propertyId: 'property-1' } },
    ));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['booking-requests', 'property-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reservations'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['availability', 'property-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['folios', 'property-1'] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['booking-request-audit', 'property-1', REQUEST_ID],
    });
  });

  it('disables duplicate writes and preserves the draft when the server reports a race', async () => {
    let rejectRequest!: (error: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }) as never);
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Modify stay' }));
    const dialog = screen.getByRole('dialog', { name: 'Modify accepted stay' });
    await within(dialog).findAllByText('€960.00');
    const submit = within(dialog).getByRole('button', { name: 'Apply stay change' });
    await userEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1);

    rejectRequest({ response: { status: 409, data: { message: 'Inventory changed; review the new quote' } } });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Inventory changed; review the new quote');
    expect(within(dialog).getByLabelText('Departure date')).toHaveValue('2026-09-12');
  });
});

describe('Booking request payments, messages, and audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.propertyId = 'property-1';
    context.read = true;
    context.write = true;
    mockApi({
      payments: {
        movements: [stripePayment, externalPayment],
        allocations: [
          {
            id: 'allocation-1',
            propertyId: 'property-1',
            bookingRequestId: REQUEST_ID,
            paymentId: PAYMENT_ID,
            installmentId: 'installment-1',
            amount: '60.00',
            createdAt: '2026-08-24T10:00:00.000Z',
          },
          {
            id: 'allocation-2',
            propertyId: 'property-1',
            bookingRequestId: REQUEST_ID,
            paymentId: PAYMENT_ID,
            installmentId: 'installment-3',
            amount: '100.00',
            createdAt: '2026-08-24T10:00:00.000Z',
          },
        ],
        resolutions: [],
      },
      installments: [
        {
          id: 'installment-1',
          propertyId: 'property-1',
          bookingRequestId: REQUEST_ID,
          label: '30% deposit',
          sortOrder: 0,
          fixedAmount: null,
          percentage: '30.00',
          resolvedAmount: '192.00',
          dueMilestone: 'arrival',
          dueDate: null,
          allocatedAmount: '50.00',
          status: 'partial',
        },
        {
          id: 'installment-2',
          propertyId: 'property-1',
          bookingRequestId: REQUEST_ID,
          label: 'Final balance',
          sortOrder: 1,
          fixedAmount: '448.00',
          percentage: null,
          resolvedAmount: '448.00',
          dueMilestone: 'checkout',
          dueDate: null,
          allocatedAmount: '0.00',
          status: 'unpaid',
        },
        {
          id: 'installment-3',
          propertyId: 'property-1',
          bookingRequestId: REQUEST_ID,
          label: 'Paid in full',
          sortOrder: 2,
          fixedAmount: '100.00',
          percentage: null,
          resolvedAmount: '100.00',
          dueMilestone: 'manual',
          dueDate: null,
          allocatedAmount: '100.00',
          status: 'paid',
        },
      ],
      emails: [
        {
          id: 'delivery-1',
          kind: 'receipt',
          status: 'failed',
          subject: 'We received your request',
          bodyText: 'Your request is awaiting review.',
          errorMessage: 'Delivery failed',
          attempts: 5,
          nextAttemptAt: null,
          lastAttemptAt: '2026-08-25T10:00:00.000Z',
          sentAt: null,
          createdAt: '2026-08-24T10:00:00.000Z',
          updatedAt: '2026-08-25T10:00:00.000Z',
        },
      ],
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
    vi.mocked(api.patch).mockResolvedValue({ data: {} } as never);
    vi.mocked(api.delete).mockResolvedValue({ data: {} } as never);
  });

  it('shows manual milestones and allocation status and edits an installment', async () => {
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Payments & plan' }));
    expect(await screen.findByText('30% deposit')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('Due at arrival')).toBeInTheDocument();
    expect(screen.getByText('Nothing is charged automatically.')).toBeInTheDocument();

    const partialEdit = screen.getByRole('button', { name: 'Edit 30% deposit' });
    expect(partialEdit).toBeEnabled();
    expect(screen.getByRole('button', {
      name: 'Remove remaining amount — €60.00 will remain paid',
    })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit Paid in full' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete Paid in full' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Final balance' }));
    const label = screen.getByRole('textbox', { name: 'Installment label' });
    await userEvent.clear(label);
    await userEvent.type(label, 'Arrival deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Save installment' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/installments/installment-2`,
      expect.objectContaining({ label: 'Arrival deposit', fixedAmount: '448.00', dueMilestone: 'checkout' }),
      { params: { propertyId: 'property-1' } },
    ));
  });

  it('shows net allocation availability and reorders installments with buttons', async () => {
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Payments & plan' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Allocate payment to Final balance' }));
    const movement = screen.getByRole('combobox', { name: 'Captured movement' });
    expect(within(movement).getByRole('option', { name: /€142.00 available.*€50.00 allocated/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Move Final balance up' }));
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        `/v1/booking-requests/${REQUEST_ID}/installments/reorder`,
        { installmentIds: ['installment-2', 'installment-1', 'installment-3'] },
        { params: { propertyId: 'property-1' } },
      );
      expect(api.patch).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps saved-card and external collection separate and rejects zero amounts', async () => {
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Payments & plan' }));
    await screen.findByRole('button', { name: 'Charge saved card' });

    await userEvent.click(screen.getByRole('button', { name: 'Charge saved card' }));
    let dialog = screen.getByRole('dialog', { name: 'Charge saved card' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Amount' }), '0');
    expect(within(dialog).getByText('Enter an amount greater than zero.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Charge saved card' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Record external payment' }));
    dialog = screen.getByRole('dialog', { name: 'Record external payment' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Amount' }), '75');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Payment method' }), 'cash');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reference' }), 'CASH-75');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record external payment' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/payments/external`,
      expect.objectContaining({
        amount: '75.00',
        currencyCode: 'EUR',
        method: 'cash',
        reference: 'CASH-75',
      }),
      { params: { propertyId: 'property-1' } },
    ));
  });

  it('offers provenance-correct refund/return/retain actions with required reasons', async () => {
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Payments & plan' }));
    await screen.findByText('Saved card · visa •••• 4242');
    expect(screen.getByText('External · bank transfer · BANK-42')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refund' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Record return' })).toHaveLength(1);

    await userEvent.click(screen.getAllByRole('button', { name: 'Retain with reason' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Retain money' });
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Amount' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Amount' }), '50');
    expect(within(dialog).getByRole('button', { name: 'Retain money' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason for retaining money' }), 'Non-refundable fee');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retain money' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/payments/${PAYMENT_ID}/retentions`,
      { amount: '50.00', reason: 'Non-refundable fee' },
      { params: { propertyId: 'property-1' } },
    ));
  });

  it('refreshes the exact request folio summary immediately after a money action', async () => {
    const accepted = {
      ...requestDetail,
      status: 'accepted',
      acceptedPriceSource: 'current',
      acceptedTotal: '670.00',
      acceptedReservationId: 'reservation-1',
      acceptedFolioId: 'folio-1',
    };
    let folioReads = 0;
    mockApi({
      detail: accepted,
      payments: { movements: [stripePayment], allocations: [], resolutions: [] },
      installments: [],
      folio: () => {
        folioReads += 1;
        return {
          id: 'folio-1',
          folioNumber: 'F-1042',
          status: 'open',
          totalCharges: '700.00',
          totalPayments: folioReads === 1 ? '192.00' : '300.00',
          balance: folioReads === 1 ? '508.00' : '400.00',
          currencyCode: 'EUR',
        };
      },
    });

    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Payments & plan' }));
    expect(await screen.findByText('€508.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refund' }));
    const dialog = screen.getByRole('dialog', { name: 'Refund saved-card payment' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText('€400.00')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/v1/folios/folio-1'))
      .toHaveLength(2);
  });

  it('retries failed messages through the scoped staff endpoint', async () => {
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Messages' }));
    expect(await screen.findByText('We received your request')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry delivery' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/emails/delivery-1/retry`,
      undefined,
      { params: { propertyId: 'property-1' } },
    ));
  });

  it('tracks simultaneous message retries independently by delivery ID', async () => {
    const secondDelivery = {
      id: 'delivery-2',
      kind: 'accepted',
      status: 'failed',
      subject: 'Your request decision',
      bodyText: 'Decision message.',
      errorMessage: 'Delivery failed',
      attempts: 2,
      nextAttemptAt: null,
      lastAttemptAt: '2026-08-25T10:01:00.000Z',
      sentAt: null,
      createdAt: '2026-08-24T10:01:00.000Z',
      updatedAt: '2026-08-25T10:01:00.000Z',
    };
    const firstDelivery = {
      ...secondDelivery,
      id: 'delivery-1',
      kind: 'receipt',
      subject: 'We received your request',
    };
    mockApi({ emails: [firstDelivery, secondDelivery] });
    const resolvers = new Map<string, () => void>();
    vi.mocked(api.post).mockImplementation((url: string) => new Promise((resolve) => {
      resolvers.set(url, () => resolve({ data: {} }));
    }) as never);
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Messages' }));
    const retries = await screen.findAllByRole('button', { name: 'Retry delivery' });

    await userEvent.click(retries[0]!);
    await userEvent.click(retries[1]!);
    expect(retries[0]).toBeDisabled();
    expect(retries[1]).toBeDisabled();

    resolvers.get(`/v1/booking-requests/${REQUEST_ID}/emails/delivery-1/retry`)?.();
    await waitFor(() => expect(retries[0]).toBeEnabled());
    expect(retries[1]).toBeDisabled();
    resolvers.get(`/v1/booking-requests/${REQUEST_ID}/emails/delivery-2/retry`)?.();
  });

  it('renders a safe audit timeline without internal or payment tokens', async () => {
    const accepted = {
      ...requestDetail,
      status: 'accepted',
      acceptedPriceSource: 'current',
      acceptedTotal: '670.00',
      acceptedReservationId: 'reservation-1',
      acceptedFolioId: 'folio-1',
      decidedBy: 'staff-user-1',
      decidedAt: '2026-08-25T11:00:00.000Z',
      stripePaymentMethodId: 'pm_secret_should_not_render',
    };
    mockApi({
      detail: accepted,
      payments: { movements: [stripePayment], allocations: [], resolutions: [] },
      emails: [],
      audit: [
        {
          id: 'audit-3',
          action: 'create',
          actorDisplay: 'staff@example.com',
          occurredAt: '2026-08-25T12:00:00.000Z',
          summary: 'payment.captured',
          details: { amount: '192.00', currencyCode: 'EUR', status: 'captured' },
        },
        {
          id: 'audit-2',
          action: 'update',
          actorDisplay: 'staff-user-1',
          occurredAt: '2026-08-25T11:00:00.000Z',
          summary: 'request.accepted',
          details: { acceptedTotal: '670.00', priceSource: 'current' },
        },
        {
          id: 'audit-1',
          action: 'create',
          actorDisplay: 'System',
          occurredAt: '2026-08-24T10:00:00.000Z',
          summary: 'request.pending',
          details: {},
        },
      ],
      folio: {
        id: 'folio-1',
        folioNumber: 'F-1042',
        status: 'open',
        totalCharges: '700.00',
        totalPayments: '192.00',
        balance: '508.00',
        currencyCode: 'EUR',
      },
    });
    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Audit' }));
    expect(await screen.findByText('Request submitted')).toBeInTheDocument();
    expect(screen.getByText('Request accepted')).toBeInTheDocument();
    expect(screen.getByText('Payment captured')).toBeInTheDocument();
    expect(screen.getByText(/staff-user-1/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('pm_secret_should_not_render');
    expect(api.get).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/audit-history`,
      { params: { propertyId: 'property-1', limit: 25 } },
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Payments & plan' }));
    expect(await screen.findByText('Operational folio summary')).toBeInTheDocument();
    expect(screen.getByText('€508.00')).toBeInTheDocument();
  });

  it('loads additional immutable audit pages without replacing the first page', async () => {
    mockApi({
      audit: (cursor: string | null) => cursor == null
        ? {
          data: [{
            source: 'audit_log',
            id: 'audit-new',
            action: 'update',
            actorDisplay: 'staff@example.com',
            occurredAt: '2026-08-25T12:00:00.000Z',
            summary: 'request.accepted',
            details: { acceptedTotal: '670.00' },
          }],
          nextCursor: 'opaque-older-page',
        }
        : {
          data: [{
            source: 'audit_log',
            id: 'audit-new',
            action: 'update',
            actorDisplay: 'staff@example.com',
            occurredAt: '2026-08-25T12:00:00.000Z',
            summary: 'request.accepted',
            details: { acceptedTotal: '670.00' },
          }, {
            source: 'audit_log',
            id: 'audit-old',
            action: 'create',
            actorDisplay: 'System',
            occurredAt: '2026-08-24T10:00:00.000Z',
            summary: 'request.pending',
            details: {},
          }],
          nextCursor: null,
        },
    });

    renderAt(`/booking-requests/${REQUEST_ID}`);
    await userEvent.click(await screen.findByRole('tab', { name: 'Audit' }));
    expect(await screen.findByText('Request accepted')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Request submitted')).toBeInTheDocument();
    expect(screen.getByText('Request accepted')).toBeInTheDocument();
    expect(screen.getAllByText('Request accepted')).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith(
      `/v1/booking-requests/${REQUEST_ID}/audit-history`,
      { params: { propertyId: 'property-1', limit: 25, cursor: 'opaque-older-page' } },
    );
  });
});

describe('Booking request locales', () => {
  it('uses domain-appropriate financial and audit terminology', () => {
    expect(en.bookingRequests.queue.sortOptions.amountDesc).toBe('Highest requested amount');
    expect(de.bookingRequests.actions).toMatchObject({
      charge: 'Karte belasten',
      deny: 'Anfrage ablehnen',
    });
    expect(de.bookingRequests.audit.actor).toBe('Ausgeführt von: {{actor}}');

    expect(fr.bookingRequests.actions.charge).toBe('Facturer la carte');
    expect(fr.bookingRequests.audit.events.resolution_refund).toContain('Remboursement');

    expect(hr.bookingRequests.actions).toMatchObject({
      charge: 'Naplati karticu',
      record: 'Evidentiraj uplatu',
    });
    expect(hr.bookingRequests.audit.actor).toContain('Izvršio');

    expect(srLatn.bookingRequests.actions.charge).toBe('Naplati karticu');
    expect(srLatn.bookingRequests.audit.actor).toContain('Izvršio');

    expect(de.bookingRequests.amounts).toMatchObject({ quoted: 'Angebot', captured: 'Eingezogen' });
    expect(hr.bookingRequests.amounts).toMatchObject({ quoted: 'Ponuda', captured: 'Naplaćeno' });
    expect(itMessages.bookingRequests.amounts).toMatchObject({ quoted: 'Preventivo', captured: 'Incassato' });
    expect(srLatn.bookingRequests.amounts).toMatchObject({ quoted: 'Ponuda', captured: 'Naplaćeno' });
    expect(fr.bookingRequests.amounts).toMatchObject({ quoted: 'Devis', captured: 'Encaissé' });
    expect(es.bookingRequests.amounts).toMatchObject({ quoted: 'Cotización', captured: 'Cobrado' });
    expect(ptBR.bookingRequests.amounts).toMatchObject({ quoted: 'Cotação', captured: 'Cobrado' });
    expect(ptBR.bookingRequests.overview.application).toBe('Solicitação de reserva');
    expect(srLatn.bookingRequests.detail.independence).toContain('finansijske radnje');
    expect(srLatn.bookingRequests.paymentActions.error).toContain('Finansijska radnja');

    expect(de.bookingRequests.overview).toMatchObject({
      application: 'Anfrage',
      noQuestions: 'Es wurden keine zusätzlichen Angaben zur Anfrage eingereicht.',
    });
    expect(de.bookingRequests.accept.recheckedOnAccept).toBe('Bei Annahme erneut geprüft');
    expect(hr.bookingRequests.detail.moneyActions).toBe('Financije');
    expect(hr.bookingRequests.overview.application).toBe('Zahtjev');
    expect(itMessages.bookingRequests.detail.moneyActions).toBe('Operazioni finanziarie');
    expect(itMessages.bookingRequests.overview.application).toBe('Richiesta');
    expect(itMessages.bookingRequests.payments.folioSummary).toBe('Riepilogo del conto operativo');

    const forbidden: Array<[string, unknown, RegExp]> = [
      ['de', de.bookingRequests, /Zitiert|Gefangen|aufgeladen|Anklage|Rekordrückkehr|Externe Rendite|Bewerbung|Bewerbungs|Abnahme|\bAntrag\b|Geldaktion/],
      ['hr', hr.bookingRequests, /Citirano|Zarobljen|Trenutni citat|Vratio se|Poricanje|Primjena|novčane akcije|Novčana akcija|prijav[aeu]/i],
      ['it', itMessages.bookingRequests, /Citato|Catturato|Citazione attuale|Negazione|Mantenuto|Applicazione|azioni di denaro|azione relativa al denaro|foglio operativo|\bSoldi\b/i],
      ['sr-Latn', srLatn.bookingRequests, /Citirano|Trenutni citat|Predat citat|novčane akcije|Novčane akcije|Novčana radnja|aplikacije|Aplikacije/],
      ['fr', fr.bookingRequests, /Cité|Capturé|Déni/],
      ['es', es.bookingRequests, /\bcitado\b|\bcapturado\b|Negación|Regreso récord|puerta de enlace/],
      ['pt-BR', ptBR.bookingRequests, /Citado|Capturado|Negação|Carregar cartão|Registro de retorno|Aplicaç|aplicaç|Inscriç|inscriç/],
    ];
    for (const [locale, namespace, terms] of forbidden) {
      expect(JSON.stringify(namespace), `${locale} has machine-literal admin vocabulary`)
        .not.toMatch(terms);
    }
  });

  it('defines every visible booking-request leaf in all eight locales', () => {
    const locales = { en, de, es, fr, hr, it: itMessages, 'pt-BR': ptBR, 'sr-Latn': srLatn };
    const leafPaths = (value: unknown, prefix = ''): string[] => {
      if (value == null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
      return Object.entries(value as Record<string, unknown>)
        .flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
    };
    const read = (value: unknown, path: string) => path.split('.').reduce<unknown>(
      (current, key) => current && typeof current === 'object'
        ? (current as Record<string, unknown>)[key]
        : undefined,
      value,
    );
    const paths = leafPaths(en.bookingRequests, 'bookingRequests');
    for (const [locale, messages] of Object.entries(locales)) {
      for (const path of paths) {
        expect(read(messages, path), `${locale} is missing ${path}`).not.toBeUndefined();
        const englishValue = read(en, path);
        const localizedValue = read(messages, path);
        if (typeof englishValue === 'string' && typeof localizedValue === 'string') {
          const placeholders = (value: string) => [...value.matchAll(/\{\{([^}]+)\}\}/g)]
            .map((match) => match[1])
            .sort();
          expect(
            placeholders(localizedValue),
            `${locale} has mismatched placeholders in ${path}`,
          ).toEqual(placeholders(englishValue));
        }
      }
    }
  });
});
