import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import Channels, { SyncLogsTable } from './Channels';

// Mock the property context so pages have a propertyId without PropertyProvider.
vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({ propertyId: 'prop-1' }),
}));

// Mock the API client.
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../lib/api';

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Channels />
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
    await userEvent.click(btn);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v1/channels/push/content', { propertyId: 'prop-1', channelConnectionId: 'cc-1' }));
  });
});
