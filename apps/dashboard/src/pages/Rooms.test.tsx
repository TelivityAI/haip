import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import Rooms, { VALID_TRANSITIONS } from './Rooms';

vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({ propertyId: 'prop-1', currencyCode: 'USD' }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';

const ROOM_CLEAN = {
  id: 'room-101',
  number: '101',
  roomTypeId: 'rt-1',
  roomTypeName: 'Deluxe King',
  floor: '1',
  status: 'clean',
};

function renderRooms(path = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Rooms />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Rooms — VALID_TRANSITIONS', () => {
  it('defines valid transitions matching the backend state machine for clean', () => {
    expect(VALID_TRANSITIONS.clean).toEqual([
      'inspected',
      'vacant_clean',
      'vacant_dirty',
      'out_of_order',
    ]);
    expect(VALID_TRANSITIONS.clean).not.toContain('guest_ready');
  });

  it('defines valid transitions matching the backend for all states', () => {
    expect(VALID_TRANSITIONS.vacant_clean).toEqual([
      'occupied',
      'vacant_dirty',
      'out_of_order',
      'out_of_service',
    ]);
    expect(VALID_TRANSITIONS.vacant_dirty).toEqual(['clean', 'out_of_order']);
    expect(VALID_TRANSITIONS.inspected).toEqual(['guest_ready', 'vacant_dirty', 'out_of_order']);
    expect(VALID_TRANSITIONS.guest_ready).toEqual(['occupied', 'vacant_dirty', 'out_of_order']);
    expect(VALID_TRANSITIONS.occupied).toEqual(['vacant_dirty']);
    expect(VALID_TRANSITIONS.out_of_order).toEqual(['vacant_dirty']);
    expect(VALID_TRANSITIONS.out_of_service).toEqual(['vacant_dirty']);
  });
});

describe('Rooms — Context menu status transitions filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/v1/rooms') {
        return Promise.resolve({ data: [ROOM_CLEAN] });
      }
      if (url === '/v1/rooms/status-summary') {
        return Promise.resolve({ data: [{ status: 'clean', count: 1 }] });
      }
      if (url === '/v1/rooms/types') {
        return Promise.resolve({ data: [{ id: 'rt-1', name: 'Deluxe King', code: 'DK' }] });
      }
      if (url === '/v1/rooms/discrepancies') {
        return Promise.resolve({ data: { discrepancies: [] } });
      }
      if (url === '/v1/reservations') {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    (api.patch as any).mockResolvedValue({ data: {} });
  });

  it('filters out unavailable states in the context menu for a clean room', async () => {
    renderRooms();

    // Wait for room 101 card to appear
    const roomCard = await screen.findByText('101');
    expect(roomCard).toBeInTheDocument();

    // Right-click the room card
    fireEvent.contextMenu(roomCard.closest('div[class*="group"]')!);

    // Context menu should appear with View Details and Mark as
    const markAsOption = await screen.findByText(/mark as/i);
    expect(markAsOption).toBeInTheDocument();

    // Hover over Mark As to open the status submenu
    await userEvent.hover(markAsOption);

    // Verify allowed transitions appear in the submenu
    // Valid for clean: inspected, vacant_clean, vacant_dirty, out_of_order
    expect(await screen.findByText(/inspected/i)).toBeInTheDocument();
    expect(screen.getByText(/vacant clean/i)).toBeInTheDocument();
    expect(screen.getByText(/vacant dirty/i)).toBeInTheDocument();
    expect(screen.getByText(/out of order/i)).toBeInTheDocument();

    // Verify unavailable states are filtered OUT
    expect(screen.queryByText(/guest ready/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/occupied/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/out of service/i)).not.toBeInTheDocument();

    // Click an allowed transition, e.g. Inspected
    await userEvent.click(screen.getByText(/inspected/i));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/v1/rooms/room-101/status',
        { status: 'inspected' },
        expect.objectContaining({ params: { propertyId: 'prop-1' } }),
      );
    });
  });
});
