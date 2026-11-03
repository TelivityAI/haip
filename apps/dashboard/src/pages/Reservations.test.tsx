import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import Reservations from './Reservations';

// Mock the property context so pages have a propertyId without PropertyProvider.
vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({ propertyId: 'prop-1', currencyCode: 'USD' }),
}));

// Mock the API client.
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';

const RES_ROW = {
  id: 'res-1',
  confirmationNumber: 'HAIP-0001',
  status: 'confirmed',
  arrivalDate: '2026-06-01',
  departureDate: '2026-06-04',
  roomTypeId: 'rt-1',
  roomTypeName: 'King',
  guestName: 'Jane Doe',
  adults: 2,
  children: 0,
};

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Reservations />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Reservations — bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ data: [RES_ROW] });
    (api.post as any).mockResolvedValue({ data: { succeeded: 1, failed: 0, results: [] } });
  });

  it('sends only status-eligible ids to the bulk-action endpoint', async () => {
    renderAt('/');
    const rowCheckbox = await screen.findByLabelText('Select row');
    await userEvent.click(rowCheckbox);

    await userEvent.selectOptions(screen.getByLabelText('Choose an action…'), 'check_in');
    await userEvent.click(screen.getByText('Apply'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body, config] = (api.post as any).mock.calls[0];
    expect(url).toBe('/v1/reservations/bulk-action');
    expect(body).toEqual({ ids: ['res-1'], action: 'check_in' });
    expect(config.params).toEqual({ propertyId: 'prop-1' });
  });

  it('disables Apply when no selected reservation is eligible for the action', async () => {
    renderAt('/');
    await userEvent.click(await screen.findByLabelText('Select row'));
    // A confirmed reservation cannot be checked out.
    await userEvent.selectOptions(screen.getByLabelText('Choose an action…'), 'check_out');

    expect(screen.getByText('0 of 1 eligible')).toBeInTheDocument();
    expect(screen.getByText('Apply').closest('button')).toBeDisabled();
  });
});

describe('Reservations — import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ data: [] });
    (api.post as any).mockResolvedValue({ data: { created: 1, failed: 0, results: [] } });
  });

  it('parses CSV lines into the JSON rows the import endpoint expects', async () => {
    renderAt('/');
    await userEvent.click(screen.getByText('Import'));
    await userEvent.type(
      screen.getByRole('textbox'),
      'g-1,2026-06-01,2026-06-04,rt-1,rp-1,599,USD,direct,2,0',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import Reservations' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = (api.post as any).mock.calls[0];
    expect(url).toBe('/v1/reservations/import');
    expect(body.propertyId).toBe('prop-1');
    expect(body.rows).toEqual([
      {
        guestId: 'g-1',
        arrivalDate: '2026-06-01',
        departureDate: '2026-06-04',
        roomTypeId: 'rt-1',
        ratePlanId: 'rp-1',
        totalAmount: '599.00',
        currencyCode: 'USD',
        source: 'direct',
        adults: 2,
        children: 0,
      },
    ]);
  });
});

describe('Reservations — unassigned queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/v1/reservations/unassigned') {
        return Promise.resolve({ data: { data: [RES_ROW], total: 1 } });
      }
      return Promise.resolve({ data: [] });
    });
    (api.patch as any).mockResolvedValue({ data: {} });
  });

  it('queries the unassigned endpoint with from/to (not arrivalDateFrom/To)', async () => {
    renderAt('/unassigned');

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/v1/reservations/unassigned', expect.anything()));
    const call = (api.get as any).mock.calls.find((c: any[]) => c[0] === '/v1/reservations/unassigned');
    expect(Object.keys(call[1].params).sort()).toEqual(['from', 'propertyId', 'to']);
  });

  it('assigns a room to an unassigned reservation', async () => {
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/v1/reservations/unassigned') {
        return Promise.resolve({ data: { data: [RES_ROW], total: 1 } });
      }
      if (url === '/v1/rooms') {
        return Promise.resolve({ data: [{ id: 'room-1', number: '101', roomTypeId: 'rt-1' }] });
      }
      return Promise.resolve({ data: [] });
    });

    renderAt('/unassigned');
    await userEvent.click(await screen.findByText('Assign Room'));
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'room-1');
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/v1/reservations/res-1/assign-room', { roomId: 'room-1' }),
    );
  });
});

describe('Reservations — Availability Calendar quick booking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/v1/rooms') {
        return Promise.resolve({
          data: [{ id: 'room-1', number: '101', roomTypeId: 'rt-1' }],
        });
      }
      if (url === '/v1/reservations') {
        return Promise.resolve({ data: [] });
      }
      if (url === '/v1/rate-plans') {
        return Promise.resolve({
          data: [
            {
              id: 'rp-1',
              name: 'Standard Rate',
              roomTypeId: 'rt-1',
              baseAmount: '150.00',
              currencyCode: 'USD',
              isActive: true,
            },
          ],
        });
      }
      if (url.startsWith('/v1/guests')) {
        return Promise.resolve({
          data: [
            { id: 'g-1', firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    (api.post as any).mockImplementation((url: string) => {
      if (url === '/v1/reservations') {
        return Promise.resolve({ data: { id: 'new-res-1' } });
      }
      return Promise.resolve({ data: {} });
    });
    (api.patch as any).mockResolvedValue({ data: {} });
  });

  it('submits a valid reservation payload without roomId, then confirms and assigns room', async () => {
    renderAt('/calendar');

    // Wait for rooms to load
    const roomHeader = await screen.findByText('101');
    expect(roomHeader).toBeInTheDocument();

    // The td cell for that room
    const cell = roomHeader.closest('tr')?.querySelectorAll('td')[1];
    expect(cell).toBeDefined();

    // Trigger drag selection on the cell
    fireEvent.mouseDown(cell!);
    fireEvent.mouseUp(window);

    // Click "Book Selected Dates"
    const bookButton = await screen.findByRole('button', { name: /book selected dates/i });
    await userEvent.click(bookButton);

    // Search and select guest
    const guestInput = screen.getByPlaceholderText(/search/i);
    await userEvent.type(guestInput, 'John');
    const guestOption = await screen.findByText('John Doe');
    await userEvent.click(guestOption);

    // Click confirm booking
    const confirmBtn = screen.getByRole('button', { name: /confirm booking/i });
    await userEvent.click(confirmBtn);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/v1/reservations',
        expect.objectContaining({
          propertyId: 'prop-1',
          guestId: 'g-1',
          roomTypeId: 'rt-1',
          ratePlanId: 'rp-1',
          adults: 1,
          totalAmount: '150.00',
          currencyCode: 'USD',
          source: 'direct',
        }),
      ),
    );

    // Verify roomId was NOT sent in the create payload
    const postPayload = (api.post as any).mock.calls.find(
      (call: any[]) => call[0] === '/v1/reservations',
    )?.[1];
    expect(postPayload).not.toHaveProperty('roomId');

    // Verify confirm and assign room were called
    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/v1/reservations/new-res-1/confirm',
        {},
        expect.objectContaining({ params: { propertyId: 'prop-1' } }),
      );
      expect(api.patch).toHaveBeenCalledWith(
        '/v1/reservations/new-res-1/assign-room',
        { roomId: 'room-1' },
        expect.objectContaining({ params: { propertyId: 'prop-1' } }),
      );
    });
  });
});
