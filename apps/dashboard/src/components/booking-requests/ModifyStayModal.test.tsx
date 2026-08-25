import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ModifyStayModal from './ModifyStayModal';
import type { BookingRequestDetail } from './types';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../../lib/api';

const request = {
  id: 'request-1',
  propertyId: 'property-1',
  status: 'accepted',
  arrivalDate: '2026-10-01',
  departureDate: '2026-10-03',
  roomTypeId: 'room-type-1',
  ratePlanId: 'rate-plan-1',
  adults: 2,
  children: 0,
  guestFirstName: 'Ada',
  guestLastName: 'Lovelace',
  guestEmail: 'ada@example.com',
  submittedTotal: '220.00',
  currencyCode: 'EUR',
  acceptedPriceSource: 'current',
  acceptedTotal: '220.00',
  acceptedReservationId: 'reservation-1',
  createdAt: '2026-08-24T09:00:00.000Z',
  updatedAt: '2026-08-24T10:00:00.000Z',
  guestPhone: null,
  specialRequests: null,
  serviceIds: [],
  formSnapshot: [],
  applicationAnswers: {},
  submittedQuoteSnapshot: { currencyCode: 'EUR', grandTotal: '220.00' },
  currentQuoteSnapshot: { currencyCode: 'EUR', grandTotal: '220.00' },
  card: null,
  customPriceReason: null,
  acceptedFolioId: 'folio-1',
  decidedBy: 'staff-1',
  decidedAt: '2026-08-24T10:00:00.000Z',
  denialReason: null,
  operationalReservation: {
    id: 'reservation-1',
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-03',
    totalAmount: '220.00',
    currencyCode: 'EUR',
    roomTypeId: 'room-type-1',
    ratePlanId: 'rate-plan-1',
    status: 'confirmed',
    updatedAt: '2026-08-25T10:00:00.000Z',
  },
} satisfies BookingRequestDetail;

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ModifyStayModal request={request} propertyId="property-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { queryClient, onClose };
}

describe('ModifyStayModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      data: {
        requestId: 'request-1',
        reservationId: 'reservation-1',
        previousArrivalDate: '2026-10-01',
        previousDepartureDate: '2026-10-03',
        previousTotal: '220.00',
        arrivalDate: '2026-10-01',
        departureDate: '2026-10-03',
        priorTotal: '220.00',
        currentTotal: '240.00',
        currencyCode: 'EUR',
        previewVersion: 1,
        previewToken: `v1:${'a'.repeat(64)}`,
      },
    } as never);
    vi.mocked(api.post).mockResolvedValue({ data: {} } as never);
  });

  it('shows the exact custom total in the proposed stay rail and submits its reason', async () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Modify accepted stay' });
    await within(dialog).findByText('€240.00');

    await userEvent.click(within(dialog).getByRole('radio', { name: /Custom total/i }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Custom total' }), '235');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Reason for custom total' }),
      'Signed offer',
    );

    const proposedStay = within(dialog).getByText('Proposed stay').parentElement!;
    expect(within(proposedStay).getByText('€235.00')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply stay change' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/v1/booking-requests/request-1/stay-amendments',
      expect.objectContaining({
        priceSource: 'custom',
        customTotal: '235.00',
        customReason: 'Signed offer',
      }),
      { params: { propertyId: 'property-1' } },
    ));
  });

  it('connects custom-money errors and required reason semantics to their controls', async () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Modify accepted stay' });
    await within(dialog).findByText('€240.00');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Custom total/i }));

    const total = within(dialog).getByRole('textbox', { name: 'Custom total' });
    await userEvent.type(total, '1.234');

    expect(total).toHaveAttribute('aria-invalid', 'true');
    expect(total).toHaveAccessibleDescription(
      'Use only the minor units supported by this currency.',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Reason for custom total' }))
      .toBeRequired();
  });
});
