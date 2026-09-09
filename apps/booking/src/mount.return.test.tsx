import { act, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mountBooking } from './mount';
import { queryClient } from './lib/queryClient';

const status = vi.hoisted(() => vi.fn().mockResolvedValue({ status: 'succeeded' }));
vi.mock('./api/client', () => ({
  setBookingKey: vi.fn(),
  errorMessage: () => 'error',
  bookingApi: { config: vi.fn().mockResolvedValue({ displayName: 'Example hotel' }), paymentReturnStatus: status },
}));

afterEach(() => { vi.restoreAllMocks(); queryClient.clear(); window.history.replaceState(null, '', '/'); });

it('mounts the returned widget on a nested host page with no router state or usable storage', async () => {
  const reference = 'r'.repeat(43);
  window.history.replaceState(null, '', `/hotel/stays/book?lang=es&haip_payment_return=${reference}#rooms`);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => { mountBooking(host); });
  await screen.findByText('Payment authorized');
  expect(status).toHaveBeenCalledWith(reference);
  expect(window.location.pathname).toBe('/hotel/stays/book');
  expect(window.location.hash).toBe('#rooms');
  expect(screen.queryByText('No booking to display.')).toBeNull();
  host.remove();
});
