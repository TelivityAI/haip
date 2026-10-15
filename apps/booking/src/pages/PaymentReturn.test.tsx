import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PaymentReturn } from './PaymentReturn';
import { paymentReturnEntry } from '../lib/paymentReturn';

const status = vi.hoisted(() => vi.fn());
vi.mock('../api/client', () => ({ bookingApi: { paymentReturnStatus: status } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const reference = 'a'.repeat(43);

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[paymentReturnEntry(`https://hotel.example/stays/book?lang=es&haip_payment_return=${reference}&redsys=ok`)]}><PaymentReturn /></MemoryRouter></QueryClientProvider>);
}

describe('hosted payment return without memory or storage', () => {
  it('bootstraps from the embedding URL and ignores browser success flags', () => {
    expect(paymentReturnEntry(`https://hotel.example/stays/book?haip_payment_return=${reference}`)).toBe(`/payment-return?reference=${reference}`);
    expect(paymentReturnEntry('https://hotel.example/stays/book?redsys=ok')).toBe('/');
    expect(paymentReturnEntry('https://hotel.example/stays/book?haip_payment_return=bad')).toBe('/');
  });
  it('shows processing before the callback and refreshes to server success', async () => {
    status.mockResolvedValueOnce({ status: 'processing' }).mockResolvedValue({ status: 'succeeded' });
    show();
    await screen.findByText('Confirming your payment');
    expect(screen.queryByText('Payment authorized')).toBeNull();
    expect(status).toHaveBeenCalledWith(reference);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check payment status' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await screen.findByText('Payment authorized');
  });
  it('shows success when the callback arrived before the return', async () => {
    status.mockResolvedValue({ status: 'succeeded' });
    show();
    await screen.findByText('Payment authorized');
    expect(screen.queryByText('Booking confirmed')).toBeNull();
  });
  it('polls a processing payment automatically until authorization arrives', async () => {
    status.mockResolvedValueOnce({ status: 'processing' }).mockResolvedValue({ status: 'succeeded' });
    show();
    await screen.findByText('Payment authorized', {}, { timeout: 4500 });
    expect(status).toHaveBeenCalledTimes(2);
  });
  it('shows booking confirmed only when the reservation is confirmed', async () => {
    status.mockResolvedValue({ status: 'succeeded', reservationStatus: 'confirmed' });
    show();
    await screen.findByText('Booking confirmed');
    expect(screen.getByText(/your booking is confirmed/i)).toBeTruthy();
    expect(screen.getByText(/contact the hotel for your booking details/i)).toBeTruthy();
  });
  it('keeps a succeeded payment as authorized while the reservation is still pending', async () => {
    status.mockResolvedValue({ status: 'succeeded', reservationStatus: 'pending' });
    show();
    await screen.findByText('Payment authorized');
    expect(screen.queryByText('Booking confirmed')).toBeNull();
    expect(screen.getByText(/contact the hotel for your booking details/i)).toBeTruthy();
  });
  it('says the guest can start again only when the reservation was cancelled', async () => {
    status.mockResolvedValue({ status: 'failed', reservationStatus: 'cancelled' });
    show();
    await screen.findByText('Payment was not completed');
    expect(screen.getByText(/this booking was cancelled because the payment did not complete/i)).toBeTruthy();
    expect(screen.getByText(/you can start again/i)).toBeTruthy();
  });
  it('warns about a duplicate booking when a failed payment left the reservation in place', async () => {
    status.mockResolvedValue({ status: 'failed', reservationStatus: 'pending' });
    show();
    await screen.findByText('Payment was not completed');
    expect(screen.getByText(/contact the hotel before trying again/i)).toBeTruthy();
    expect(screen.queryByText(/you can start again/i)).toBeNull();
    expect(screen.queryByText('Booking confirmed')).toBeNull();
  });
  it('shows a cancelled payment with retry guidance', async () => {
    status.mockResolvedValue({ status: 'cancelled' });
    show();
    await screen.findByText('Payment was cancelled');
    expect(screen.getByText(/contact the hotel before trying again/i)).toBeTruthy();
  });
  it('offers status retry without rebooking when lookup fails', async () => {
    status.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 'processing' });
    show();
    await screen.findByText('We could not check your payment');
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    await screen.findByText('Confirming your payment');
  });
});
