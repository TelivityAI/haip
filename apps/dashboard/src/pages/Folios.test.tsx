import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import Folios from './Folios';

vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({ propertyId: 'prop-1' }),
}));

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';

const FOLIO = {
  id: 'folio-1',
  folioNumber: 'F-0001',
  type: 'guest',
  status: 'open',
  reservationId: 'res-1',
  guestId: 'guest-1',
  balance: 250,
  currencyCode: 'USD',
};

const SIBLING = { ...FOLIO, id: 'folio-2', folioNumber: 'F-0002' };

const CHARGE = {
  id: 'charge-1',
  description: 'Minibar',
  type: 'minibar',
  amount: 25,
  serviceDate: '2026-06-02',
  createdAt: '2026-06-02T10:00:00Z',
};

const PAYMENT = {
  id: 'pay-1',
  amount: 100,
  method: 'credit_card',
  status: 'captured',
  createdAt: '2026-06-02T11:00:00Z',
};

function mockGet(overrides: Record<string, unknown> = {}) {
  (api.get as any).mockImplementation((url: string) => {
    if (url in overrides) return Promise.resolve({ data: overrides[url] });
    if (url === '/v1/folios/folio-1') return Promise.resolve({ data: FOLIO });
    if (url === '/v1/folios/folio-1/charges') return Promise.resolve({ data: [CHARGE] });
    if (url === '/v1/payments') return Promise.resolve({ data: [PAYMENT] });
    if (url === '/v1/folios') return Promise.resolve({ data: [FOLIO, SIBLING] });
    if (url === '/v1/folios/routing-rules') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/folio-1']}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Folios />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Folios — split folios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet();
    (api.post as any).mockResolvedValue({ data: { moved: 1 } });
  });

  it('lists routing rules for the folio reservation', async () => {
    await waitFor(() => undefined);
    mockGet({ '/v1/folios/routing-rules': [{ id: 'rr-1', chargeType: 'minibar', targetFolioId: 'folio-2', priority: 5 }] });
    renderDetail();

    expect(await screen.findByText('Routing Rules')).toBeInTheDocument();
    const call = (api.get as any).mock.calls.find((c: any[]) => c[0] === '/v1/folios/routing-rules');
    expect(call[1].params).toEqual({ propertyId: 'prop-1', reservationId: 'res-1' });
    expect(await screen.findByText('F-0002')).toBeInTheDocument();
  });

  it('creates a routing rule for a charge type and target folio', async () => {
    renderDetail();
    await userEvent.click(await screen.findByText('New Routing Rule'));
    await userEvent.selectOptions(screen.getByLabelText('Charge type'), 'minibar');
    await userEvent.selectOptions(screen.getByLabelText('Target folio'), 'folio-2');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/v1/folios/routing-rules', {
      propertyId: 'prop-1',
      reservationId: 'res-1',
      chargeType: 'minibar',
      targetFolioId: 'folio-2',
      priority: 0,
    });
  });

  it('moves a single charge to a sibling folio', async () => {
    renderDetail();
    await userEvent.click(await screen.findByText('Move Transactions'));
    await userEvent.selectOptions(screen.getByLabelText('Charge'), 'charge-1');
    await userEvent.selectOptions(screen.getByLabelText('Target folio'), 'folio-2');
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/folios/folio-1/move-transactions', {
        propertyId: 'prop-1',
        toFolioId: 'folio-2',
        chargeId: 'charge-1',
      }),
    );
  });

  it('moves all charges of a type when switched to bulk mode', async () => {
    renderDetail();
    await userEvent.click(await screen.findByText('Move Transactions'));
    await userEvent.click(screen.getByLabelText('All charges of a type'));
    await userEvent.selectOptions(screen.getByLabelText('Charge type'), 'food_beverage');
    await userEvent.selectOptions(screen.getByLabelText('Target folio'), 'folio-2');
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/folios/folio-1/move-transactions', {
        propertyId: 'prop-1',
        toFolioId: 'folio-2',
        chargeType: 'food_beverage',
      }),
    );
  });

  it('keeps accepted-pricing corrections out of individual reverse and move controls', async () => {
    const acceptedBase = {
      ...CHARGE,
      id: 'accepted-base',
      description: 'Accepted room',
      sourceKey: 'accepted-pricing:reservation:res-1:night:2026-06-02',
    };
    const correction = {
      ...CHARGE,
      id: 'accepted-correction',
      description: 'Accepted amendment correction',
      amount: -20,
      parentChargeId: acceptedBase.id,
      adjustsChargeId: acceptedBase.id,
    };
    const taxChild = {
      ...CHARGE,
      id: 'accepted-tax',
      description: 'Accepted room tax',
      type: 'tax',
      parentChargeId: acceptedBase.id,
    };
    mockGet({
      '/v1/folios/folio-1/charges': [acceptedBase, taxChild, correction, CHARGE],
    });
    renderDetail();

    const correctionRow = (await screen.findByText(correction.description)).closest('tr')!;
    expect(within(correctionRow).queryByText('Reverse')).not.toBeInTheDocument();
    const taxRow = screen.getByText(taxChild.description).closest('tr')!;
    expect(within(taxRow).queryByText('Reverse')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Move Transactions'));
    const chargeSelect = screen.getByLabelText('Charge');
    expect(within(chargeSelect).queryByRole('option', { name: /Accepted room/ })).not.toBeInTheDocument();
    expect(within(chargeSelect).queryByRole('option', { name: /Accepted amendment correction/ }))
      .not.toBeInTheDocument();
    expect(within(chargeSelect).queryByRole('option', { name: /Accepted room tax/ }))
      .not.toBeInTheDocument();
    expect(within(chargeSelect).getByRole('option', { name: /Minibar/ })).toBeInTheDocument();
  });
});

describe('Folios — payment corrections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet();
    (api.post as any).mockResolvedValue({ data: { op: 'refund' } });
  });

  it('lets the API pick the legal op when none is chosen', async () => {
    renderDetail();
    await userEvent.click(await screen.findByText('Correct'));
    await userEvent.click(screen.getByRole('button', { name: 'Apply Correction' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/payments/pay-1/correct', { propertyId: 'prop-1' }),
    );
  });

  it('sends an explicit op override when one is chosen', async () => {
    renderDetail();
    await userEvent.click(await screen.findByText('Correct'));
    await userEvent.selectOptions(screen.getByLabelText('Operation'), 'refund');
    await userEvent.click(screen.getByRole('button', { name: 'Apply Correction' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/payments/pay-1/correct', {
        propertyId: 'prop-1',
        op: 'refund',
      }),
    );
  });

  it('offers capture and void on an authorized payment instead of refund', async () => {
    mockGet({ '/v1/payments': [{ ...PAYMENT, status: 'authorized' }] });
    renderDetail();

    expect(await screen.findByText('Capture')).toBeInTheDocument();
    expect(screen.getByText('Void')).toBeInTheDocument();
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
  });

  it('captures an authorized payment', async () => {
    mockGet({ '/v1/payments': [{ ...PAYMENT, status: 'authorized' }] });
    renderDetail();
    await userEvent.click(await screen.findByText('Capture'));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/payments/pay-1/capture', null));
  });
});
