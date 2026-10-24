import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CheckIn } from './CheckIn';

const sessionMock = vi.fn();
const payMock = vi.fn();
const submitRedirect = vi.fn();

vi.mock('../api/checkInClient', () => ({
  checkInApi: {
    session: (...args: unknown[]) => sessionMock(...args),
    pay: (...args: unknown[]) => payMock(...args),
    upsells: vi.fn().mockResolvedValue({ offers: [] }),
    access: vi.fn(),
    preRegister: vi.fn(),
    acceptUpsell: vi.fn(),
    selfCheckIn: vi.fn(),
    worldlineTokenization: vi.fn(),
    requestLink: vi.fn(),
  },
  setCheckInToken: vi.fn(),
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../lib/submit-redirect-next-action', () => ({
  submitRedirectNextAction: (...args: unknown[]) => submitRedirect(...args),
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue(null),
}));

const baseSession = {
  property: {
    id: 'p1',
    name: 'Demo',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    timezone: 'UTC',
    currencyCode: 'EUR',
    guestRegistrationRequired: true,
    branding: { displayName: 'Demo Hotel' },
  },
  reservation: {
    id: 'r1',
    confirmationNumber: 'C1',
    status: 'confirmed',
    arrivalDate: '2099-01-01',
    departureDate: '2099-01-03',
    nights: 2,
    totalAmount: '200.00',
    currencyCode: 'EUR',
    roomTypeName: 'Deluxe',
    roomNumber: null,
    registrationSubmittedAt: '2099-01-01T00:00:00Z',
    registrationSignedAt: '2099-01-01T00:00:00Z',
    registrationData: {},
    onlineCheckInCompletedAt: null,
    hasIdDocument: true,
  },
  guest: { firstName: 'Ada', lastName: 'Lovelace' },
  config: {
    enabled: true,
    selfCheckInEnabled: true,
    checkInStartTime: '15:00',
    autoAssignRoom: true,
    requireIdPhoto: true,
    requirePaymentWhenBalanceDue: true,
    accessMode: 'pin_instructions',
    accessInstructions: null,
    walletEnabled: true,
  },
  folioBalance: 50,
  registrationComplete: true,
  roomReady: true,
  canSelfCheckIn: { allowed: false, reason: 'Outstanding balance must be paid' },
  steps: { registration: true, id: true, payment: false, checkedIn: false },
  payment: { provider: 'mock', clientMode: 'mock' as const },
  francePackEnabled: false,
  stripePublishableKey: null,
};

function renderPay(session: typeof baseSession, search = '?token=tok&step=pay') {
  sessionMock.mockResolvedValue(session);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/check-in${search}`]}>
        <Routes>
          <Route path="/check-in" element={<CheckIn />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CheckIn payment modes', () => {
  beforeEach(() => {
    sessionMock.mockReset();
    payMock.mockReset();
    submitRedirect.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mock mode shows demo pay and posts tok_demo', async () => {
    payMock.mockResolvedValue({ ...baseSession, folioBalance: 0, nextAction: undefined });
    renderPay(baseSession);
    await waitFor(() => expect(screen.getByRole('button', { name: /Pay \(demo\)/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Pay \(demo\)/i }));
    await waitFor(() => expect(payMock).toHaveBeenCalledTimes(1));
    expect(payMock.mock.calls[0][0]).toMatchObject({
      gatewayPaymentToken: 'tok_demo',
      gatewayProvider: 'mock',
      amount: 50,
    });
  });

  it('redsys mode redirects via nextAction', async () => {
    const nextAction = {
      type: 'redirect' as const,
      url: 'https://sis-t.redsys.es:25443/sis/realizarPago',
      method: 'POST' as const,
      formFields: { Ds_SignatureVersion: 'HMAC_SHA512_V1' },
    };
    payMock.mockResolvedValue({ ...baseSession, nextAction });
    renderPay({
      ...baseSession,
      payment: { provider: 'redsys', clientMode: 'redsys' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Pay securely via Redsys/i })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: /Pay securely via Redsys/i }));
    await waitFor(() => expect(payMock).toHaveBeenCalledTimes(1));
    expect(payMock.mock.calls[0][0].gatewayProvider).toBe('redsys');
    expect(payMock.mock.calls[0][0].returnUrl).toContain('step=ready');
    await waitFor(() => expect(submitRedirect).toHaveBeenCalledWith(nextAction));
  });

  it('does not offer mock pay when gateway is unconfigured', async () => {
    renderPay({
      ...baseSession,
      payment: { provider: 'unsupported', clientMode: 'unsupported' },
    });
    await waitFor(() =>
      expect(screen.getByText(/Payment is not configured/i)).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: /Pay \(demo\)/i })).toBeNull();
  });
});
