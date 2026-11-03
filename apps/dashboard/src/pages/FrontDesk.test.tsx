import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/ui/Toast';
import FrontDesk from './FrontDesk';

vi.mock('../context/PropertyContext', () => ({
  useProperty: () => ({ propertyId: 'prop-1', currencyCode: 'BRL', property: {} }),
}));

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from '../lib/api';

const mockRooms = [
  { id: 'room-101', number: '101', roomNumber: '101', status: 'guest_ready', roomTypeId: 'rt-standard' },
  { id: 'room-102', number: '102', roomNumber: '102', status: 'guest_ready', roomTypeId: 'rt-standard' },
  { id: 'room-201', number: '201', roomNumber: '201', status: 'guest_ready', roomTypeId: 'rt-deluxe' },
];

const mockRoomTypes = [
  { id: 'rt-standard', name: 'Standard Double', code: 'STD', maxOccupancy: 2 },
  { id: 'rt-deluxe', name: 'Deluxe Suite', code: 'DLX', maxOccupancy: 4 },
];

const mockRatePlans = [
  { id: 'rp-std-bar', roomTypeId: 'rt-standard', name: 'Standard BAR', code: 'SBAR', baseAmount: '150.00', isActive: true },
  { id: 'rp-std-promo', roomTypeId: 'rt-standard', name: 'Standard Promo', code: 'SPRO', baseAmount: '120.00', isActive: true },
  { id: 'rp-dlx-bar', roomTypeId: 'rt-deluxe', name: 'Deluxe BAR', code: 'DBAR', baseAmount: '300.00', isActive: true },
  { id: 'rp-dlx-inactive', roomTypeId: 'rt-deluxe', name: 'Deluxe Inactive', code: 'DINA', baseAmount: '200.00', isActive: false },
];

function renderFrontDesk() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/front-desk']}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <FrontDesk />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('FrontDesk — Walk-in reverse filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      if (url.includes('/reservations')) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes('/by-status')) {
        return Promise.resolve({ data: mockRooms });
      }
      if (url.includes('/types')) {
        return Promise.resolve({ data: mockRoomTypes });
      }
      if (url.includes('/rate-plans')) {
        return Promise.resolve({ data: mockRatePlans });
      }
      return Promise.resolve({ data: [] });
    });
  });

  it('auto-selects room type and filters selectable tariffs when selecting room first', async () => {
    const user = userEvent.setup();
    renderFrontDesk();

    // Open Walk-In modal
    const walkInBtn = await screen.findByRole('button', { name: /walk-in|hóspede sem reserva/i });
    await user.click(walkInBtn);

    // Wait for modal to render
    expect(await screen.findByText(/room 1|quarto 1/i)).toBeInTheDocument();

    const roomSelect = screen.getByRole('combobox', { name: /assign room|atribuir quarto/i });
    const roomTypeSelect = screen.getByRole('combobox', { name: /room type|tipo de quarto/i });
    const ratePlanSelect = screen.getByRole('combobox', { name: /rate plan|plano de tarifa/i });

    // Initial state: room type is empty
    expect(roomTypeSelect).toHaveValue('');

    // Select Room 101 (Standard Double)
    await user.selectOptions(roomSelect, 'room-101');

    // Room type should automatically be selected to Standard Double
    expect(roomTypeSelect).toHaveValue('rt-standard');

    // Tariffs should be filtered: only Standard tariffs should be present, Deluxe filtered out
    await waitFor(() => {
      const options = Array.from(ratePlanSelect.querySelectorAll('option')).map((o) => o.value);
      expect(options).toContain('rp-std-bar');
      expect(options).toContain('rp-std-promo');
      expect(options).not.toContain('rp-dlx-bar');
      expect(options).not.toContain('rp-dlx-inactive');
    });

    // Now select Room 201 (Deluxe Suite)
    await user.selectOptions(roomSelect, 'room-201');

    // Room type should automatically switch to Deluxe Suite
    expect(roomTypeSelect).toHaveValue('rt-deluxe');

    // Tariffs should now be filtered to Deluxe active tariffs only
    await waitFor(() => {
      const options = Array.from(ratePlanSelect.querySelectorAll('option')).map((o) => o.value);
      expect(options).toContain('rp-dlx-bar');
      expect(options).not.toContain('rp-std-bar');
      expect(options).not.toContain('rp-std-promo');
      expect(options).not.toContain('rp-dlx-inactive');
    });
  });
});
