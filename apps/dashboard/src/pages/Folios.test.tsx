import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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

function renderDetail(entry = '/folio-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[entry]}>
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
});

describe('Folios — payment corrections', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet();
    (api.post as any).mockResolvedValue({ data: { op: 'refund' } });
  });

  it.each(['ok', 'ko'])('recovers a hosted %s return without treating the browser flag as authorization', async (outcome) => {
    mockGet({ '/v1/payments': [{ ...PAYMENT, status: 'pending' }], '/v1/payments/client-config': { provider: 'redsys', clientMode: 'redsys' } });
    renderDetail(`/folio-1?redsys=${outcome}`);
    expect(await screen.findByText(outcome === 'ok'
      ? 'Returned from Redsys. Payment status updates when the bank notification arrives.'
      : 'Redsys payment was cancelled or declined.')).toBeInTheDocument();
    expect(await screen.findByText('F-0001')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByText('Capture')).not.toBeInTheDocument();
    expect(screen.queryByText('Void')).not.toBeInTheDocument();
  });

  it('asks the API to read hosted checkout status and does not treat the return query as authorization', async () => {
    mockGet({
      '/v1/payments': [{ ...PAYMENT, status: 'pending' }],
      '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' },
    });
    let finishSync: (value: { data: { payments: { id: string; status: string }[] } }) => void = () => {};
    (api.post as any).mockImplementation(() => new Promise((resolve) => { finishSync = resolve; }));
    renderDetail('/folio-1?worldline=return');
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v1/payments/worldline/sync', null, {
        params: { propertyId: 'prop-1', folioId: 'folio-1' },
      }),
    );
    expect(screen.queryByText('Card authorization is still being checked.')).not.toBeInTheDocument();
    expect(screen.queryByText('Card authorization is held.')).not.toBeInTheDocument();
    finishSync({ data: { payments: [{ id: 'pay-1', status: 'pending' }] } });
    expect(await screen.findByText('Card authorization is still being checked.')).toBeInTheDocument();
    expect(screen.queryByText('Capture')).not.toBeInTheDocument();
    expect(screen.queryByText('Void')).not.toBeInTheDocument();
  });

  it.each([
    ['authorized', 'Card authorization is held.'],
    ['failed', 'Card authorization was declined.'],
    ['captured', 'Card payment was captured.'],
  ])('toasts the %s result from the sync body', async (status, message) => {
    mockGet({
      '/v1/payments': [{ ...PAYMENT, status: 'pending' }],
      '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' },
    });
    (api.post as any).mockResolvedValue({ data: { payments: [{ id: 'pay-1', status }] } });
    renderDetail('/folio-1?worldline=return');
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Capture')).not.toBeInTheDocument();
    expect(screen.queryByText('Void')).not.toBeInTheDocument();
  });

  it('polls a pending challenge until it is authorized, then stops', async () => {
    vi.useFakeTimers();
    try {
      mockGet({
        '/v1/payments': [{ ...PAYMENT, status: 'pending' }],
        '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' },
      });
      let calls = 0;
      (api.post as any).mockImplementation(() => {
        calls += 1;
        return Promise.resolve({
          data: { payments: [{ id: 'pay-1', status: calls < 2 ? 'pending' : 'authorized' }] },
        });
      });
      renderDetail('/folio-1?worldline=return');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls).toBe(1);
      expect(screen.getByText('Card authorization is still being checked.')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(calls).toBe(2);
      expect(screen.getByText('Card authorization is held.')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling when the folio page unmounts', async () => {
    vi.useFakeTimers();
    try {
      mockGet({
        '/v1/payments': [{ ...PAYMENT, status: 'pending' }],
        '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' },
      });
      (api.post as any).mockResolvedValue({ data: { payments: [{ id: 'pay-1', status: 'pending' }] } });
      const view = renderDetail('/folio-1?worldline=return');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const calls = vi.mocked(api.post).mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(vi.mocked(api.post).mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps checking a pending Worldline payment after the return query is gone', async () => {
    mockGet({
      '/v1/payments': [{
        ...PAYMENT,
        status: 'pending',
        gatewayProvider: 'worldline',
        createdAt: new Date().toISOString(),
      }],
      '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' },
    });
    (api.post as any).mockResolvedValue({ data: { payments: [{ id: 'pay-1', status: 'authorized' }] } });
    renderDetail('/folio-1');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/payments/worldline/sync', null, {
      params: { propertyId: 'prop-1', folioId: 'folio-1' },
    }));
    expect(await screen.findByText('Card authorization is held.')).toBeInTheDocument();
  });

  it('does not toast when the sync has no pending payment left', async () => {
    mockGet({
      '/v1/payments': [{
        ...PAYMENT,
        status: 'pending',
        gatewayProvider: 'worldline',
        createdAt: new Date().toISOString(),
      }],
      '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' },
    });
    (api.post as any).mockResolvedValue({ data: { payments: [] } });
    renderDetail('/folio-1');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/payments/worldline/sync', null, {
      params: { propertyId: 'prop-1', folioId: 'folio-1' },
    }));
    expect(screen.queryByText('Card authorization is still being checked.')).not.toBeInTheDocument();
  });

  it('does not poll a Worldline challenge that is already past the deadline', async () => {
    mockGet({
      '/v1/payments': [{
        ...PAYMENT,
        status: 'pending',
        gatewayProvider: 'worldline',
        createdAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      }],
      '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' },
    });
    renderDetail('/folio-1');
    expect(await screen.findByText('F-0001')).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/v1/payments', expect.anything()));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('authorizes from the in-page card field and does not send a card number', async () => {
    mockGet({ '/v1/payments/client-config': { provider: 'worldline', clientMode: 'worldline' } });
    const submitTokenization = vi.fn().mockResolvedValue({ success: true, hostedTokenizationId: 'ht-1' });
    window.Tokenizer = class {
      initialize = vi.fn().mockResolvedValue(undefined);
      submitTokenization = submitTokenization;
    } as unknown as Window['Tokenizer'];
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/v1/payments/worldline/tokenization') {
        return Promise.resolve({
          data: {
            hostedTokenizationUrl: 'https://payment.preprod.direct.worldline-solutions.com/hostedtokenization/tokenization/form/session-1',
            sri: null,
            tokenizerScriptUrl: 'https://payment.preprod.direct.worldline-solutions.com/hostedtokenization/js/client/tokenizer.min.js',
          },
        });
      }
      return Promise.resolve({ data: { status: 'authorized' } });
    });
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: /Authorize Card/i }));
    await userEvent.type(screen.getByRole('spinbutton'), '100');
    await userEvent.click(await screen.findByRole('button', { name: /^Authorize$/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/v1/payments/authorize',
        expect.objectContaining({
          gatewayProvider: 'worldline',
          gatewayPaymentToken: 'ht-1',
          propertyId: 'prop-1',
          folioId: 'folio-1',
        }),
      ),
    );
    const authorizeBody = vi.mocked(api.post).mock.calls.find((call) => call[0] === '/v1/payments/authorize')?.[1];
    expect(JSON.stringify(authorizeBody)).not.toMatch(/cardNumber|cvv/i);
    delete window.Tokenizer;
  });

  it('submits the hosted authorization form returned by the property-scoped API', async () => {
    mockGet({ '/v1/payments/client-config': { provider: 'redsys', clientMode: 'redsys' } });
    const nextAction = { type: 'redirect', method: 'POST', url: 'https://bank.example/checkout', formFields: { Ds_MerchantParameters: 'test-parameters', Ds_Signature: 'test-signature' } };
    vi.mocked(api.post).mockResolvedValue({ data: { status: 'pending', nextAction } });
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: /Authorize Card/i }));
    await userEvent.type(screen.getByRole('spinbutton'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Authorize with Redsys' }));
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const submitted = submit.mock.contexts[0] as HTMLFormElement;
    expect(api.post).toHaveBeenCalledWith('/v1/payments/authorize', expect.objectContaining({ propertyId: 'prop-1', folioId: 'folio-1', amount: '100.00', currencyCode: 'USD', gatewayProvider: 'redsys' }));
    expect(submitted.method).toBe('post');
    expect(submitted.action).toBe(nextAction.url);
    expect(new FormData(submitted).get('Ds_MerchantParameters')).toBe('test-parameters');
    submitted.remove();
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
