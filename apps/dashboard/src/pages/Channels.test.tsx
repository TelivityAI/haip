import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import Channels, { SyncLogsTable } from './Channels';

// Mock the property context so pages have a propertyId without PropertyProvider.
// currencyCode is part of that contract: a real property always has one, and
// this mock omitting it was only survivable while the app invented a default
// when it was missing. It no longer does — an absent code renders an
// unsymbolled number — so a fixture without a currency was asserting the
// invention rather than the formatting.
vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({ propertyId: 'prop-1', currencyCode: 'USD', properties: [{ id: 'prop-1', name: 'Test property' }] }),
}));

// Mock the API client.
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[`/channels${path}`]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Routes><Route path="/channels/*" element={<Channels />} /></Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('SyncLogsTable', () => {
  it('renders an empty state with no logs', () => {
    render(<SyncLogsTable logs={[]} />);
    expect(screen.getByText('No sync logs yet')).toBeInTheDocument();
  });

  it('renders rows with status badges', () => {
    render(
      <SyncLogsTable
        logs={[
          { id: '1', action: 'content_push', status: 'success', createdAt: '2026-06-01T10:00:00Z' },
          { id: '2', action: 'content_push', status: 'failed', errorMessage: 'boom', createdAt: '2026-06-01T11:00:00Z' },
        ]}
      />,
    );
    expect(screen.getAllByText('content_push')).toHaveLength(2);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });
});

describe('Channels — create connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ data: [] });
    (api.post as any).mockResolvedValue({ data: {} });
  });

  it('sends adapterType (defaulting to booking_com) in the create payload', async () => {
    renderAt('/');
    await userEvent.click(screen.getByText('Add Connection'));
    await userEvent.click(screen.getByText('Create Connection'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = (api.post as any).mock.calls[0];
    expect(url).toBe('/v1/channels/connections');
    expect(body.adapterType).toBe('booking_com');
    expect(body.propertyId).toBe('prop-1');
  });
});

describe('Channels — push content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/connections/cc-1')) {
        return Promise.resolve({ data: { id: 'cc-1', channelCode: 'demo_channel', adapterType: 'mock', status: 'active' } });
      }
      return Promise.resolve({ data: [] }); // logs
    });
    (api.post as any).mockResolvedValue({ data: [{ channelConnectionId: 'cc-1', result: { success: true } }] });
  });

  it('calls the content push endpoint with the connection id', async () => {
    renderAt('/cc-1');
    const btn = await screen.findByText(/Push Content/i);
    expect(api.get).toHaveBeenCalledWith('/v1/rooms/types', { params: { propertyId: 'prop-1' } });
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/v1/room-types')).toBe(false);
    await userEvent.click(btn);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/channels/push/content', { propertyId: 'prop-1', channelConnectionId: 'cc-1' }));
  });

  it('surfaces adapter errors returned in the push response', async () => {
    (api.post as any).mockResolvedValue({
      data: [{
        channelConnectionId: 'cc-1',
        result: {
          success: false,
          errors: [{ item: 'content', message: 'Content push is not supported by SiteMinder pmsXchange' }],
        },
      }],
    });

    renderAt('/cc-1');
    const btn = await screen.findByText(/Push Content/i);
    await userEvent.click(btn);

    await waitFor(() => expect(screen.getByText(/SiteMinder pmsXchange/i)).toBeInTheDocument());
  });
});

describe('Channels — rate parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/v1/channels/connections') {
        return Promise.resolve({ data: [{ id: 'cc-1', channelCode: 'booking_com', channelName: 'Booking.com' }] });
      }
      if (url === '/v1/channels/rate-parity') {
        return Promise.resolve({
          data: [{
            ratePlanId: 'rp-1',
            ratePlanName: 'BAR',
            baseAmount: 150,
            parityViolations: 1,
            channels: [{
              channelConnectionId: 'cc-1',
              channelCode: 'booking_com',
              channelName: 'Booking.com',
              channelRateCode: 'BAR',
              effectiveRate: 165,
              hasOverride: true,
              isParity: false,
              variance: 15,
            }],
          }],
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  it('renders baseAmount and per-channel effectiveRate from the API', async () => {
    renderAt('/rate-parity');
    expect(await screen.findByText('BAR')).toBeInTheDocument();
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    expect(screen.getByText('$165.00')).toBeInTheDocument();
    expect(screen.getByText('Violation')).toBeInTheDocument();
    expect(screen.getByText('Override')).toBeInTheDocument();
  });
});


describe('Channels — remove connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url.includes('/connections/cc-1')
      ? { id: 'cc-1', channelCode: 'booking_com', channelName: 'Test connection', status: 'active' } : [] }));
    vi.mocked(api.delete).mockResolvedValue({ data: { isActive: false } });
  });
  it('requires confirmation, identifies the target, and returns to the scoped list', async () => {
    renderAt('/cc-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove connection' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Test connection · Test property');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove connection' })[1]);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v1/channels/connections/cc-1', { params: { propertyId: 'prop-1' }, skipErrorToast: true }));
    expect(await screen.findByRole('heading', { name: 'Channels' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Connection removed.');
  });
  it('keeps a failed removal open with an inline error and allows retry', async () => {
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('not allowed')).mockResolvedValueOnce({ data: {} });
    renderAt('/cc-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove connection' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove connection' })[1]);
    expect(await screen.findByRole('alert')).toHaveTextContent('The connection could not be removed');
    expect(screen.getByRole('dialog')).toBeVisible();
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove connection' })[1]);
    expect(await screen.findByRole('heading', { name: 'Channels' })).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledTimes(2);
  });
});
