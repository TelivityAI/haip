import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Cashier from './Cashier';

vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({
    propertyId: 'prop-1',
    currencyCode: 'USD',
    properties: [{ id: 'prop-1', name: 'Test property' }],
  }),
}));

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';

function renderReport(sessionId = 'sess-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[`/cashier/report/${sessionId}`]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/cashier/*" element={<Cashier />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Cashier SessionReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads countedBalance and variance from the report root (#380)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        session: {
          id: 'sess-1',
          cashDrawerId: 'drawer-1',
          cashierUserId: 'user-1',
          status: 'closed',
          openingFloat: '200.00',
          openedAt: '2026-06-01T08:00:00Z',
          closedAt: '2026-06-01T16:00:00Z',
        },
        movementSummary: {
          payment: { count: 2, total: '250.00' },
          refund: { count: 0, total: '0.00' },
          paid_out: { count: 1, total: '52.50' },
          drop: { count: 0, total: '0.00' },
        },
        expectedBalance: '397.50',
        countedBalance: '350.00',
        variance: '-47.50',
      },
    } as never);

    renderReport();

    await waitFor(() => {
      expect(screen.getByText('Variance').closest('div')).toHaveTextContent('$-47.50');
    });
    expect(screen.getByText('Counted').closest('div')).toHaveTextContent('$350.00');
    expect(screen.getByText('Expected').closest('div')).toHaveTextContent('$397.50');
    expect(api.get).toHaveBeenCalledWith('/v1/cash/sessions/sess-1/report', {
      params: { propertyId: 'prop-1' },
    });
  });

  it('falls back to session.countedBalance / session.variance for older shapes', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        session: {
          id: 'sess-1',
          status: 'closed',
          openingFloat: '200.00',
          countedBalance: '350.00',
          variance: '-47.50',
        },
        expectedBalance: '397.50',
        movementSummary: {},
      },
    } as never);

    renderReport();

    await waitFor(() => {
      expect(screen.getByText('Variance').closest('div')).toHaveTextContent('$-47.50');
    });
    expect(screen.getByText('Counted').closest('div')).toHaveTextContent('$350.00');
  });
});
