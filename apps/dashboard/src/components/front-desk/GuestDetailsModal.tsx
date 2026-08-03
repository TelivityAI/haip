import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, StickyNote, LogIn, LogOut } from 'lucide-react';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';
import StatusBadge from '../ui/StatusBadge';
import ReservationPartyPanel from '../reservations/ReservationPartyPanel';

export interface GuestDetailsReservation {
  id: string;
  confirmationNumber: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  roomId?: string;
  roomNumber?: string;
  roomTypeId?: string;
  roomTypeName?: string;
  guestId?: string;
  guestName?: string;
  guest?: {
    firstName: string;
    lastName: string;
    vipLevel?: string;
    loyaltyNumber?: string | null;
    email?: string | null;
    phone?: string | null;
    nationality?: string | null;
  };
  bookingId?: string;
  ratePlanId?: string;
  totalAmount?: string;
  doNotMove?: boolean;
  balance?: number;
}

interface GuestProfile {
  id: string;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  vipLevel?: string | null;
  loyaltyNumber?: string | null;
}

interface FolioRow {
  id: string;
  balance?: number;
}

interface ChargeRow {
  id: string;
  description?: string;
  amount: number;
  isReversed?: boolean;
}

interface PaymentRow {
  id: string;
  amount: number;
  method?: string;
}

const ARRIVAL_STATUSES = new Set(['confirmed', 'assigned']);
/** API move-room allows assigned + in-house. */
const MOVE_STATUSES = new Set(['assigned', 'checked_in', 'stayover', 'due_out']);
const CHECKOUT_STATUSES = new Set(['checked_in', 'stayover', 'due_out']);

export default function GuestDetailsModal({
  open,
  reservation,
  propertyId,
  doorPin,
  onClose,
  onNotes,
  onMove,
  onCheckIn,
  onCheckOut,
  guestLabel,
}: {
  open: boolean;
  reservation: GuestDetailsReservation | null;
  propertyId: string;
  doorPin?: string | null;
  onClose: () => void;
  onNotes: (r: GuestDetailsReservation) => void;
  onMove: (r: GuestDetailsReservation) => void;
  onCheckIn: (r: GuestDetailsReservation) => void;
  onCheckOut?: (r: GuestDetailsReservation) => void;
  guestLabel: (r: GuestDetailsReservation) => string;
}) {
  const { t } = useTranslation();
  const guestId = reservation?.guestId;

  const { data: profile } = useQuery<GuestProfile | null>({
    queryKey: ['guest-profile', guestId],
    queryFn: async () => {
      const r = await api.get(`/v1/guests/${guestId}`);
      return (r.data?.data ?? r.data ?? null) as GuestProfile | null;
    },
    enabled: open && !!guestId,
  });

  const { data: folio } = useQuery<FolioRow | null>({
    queryKey: ['folio-for-reservation', reservation?.id, propertyId],
    queryFn: async () => {
      const r = await api.get('/v1/folios', {
        params: { propertyId, reservationId: reservation!.id, limit: 5 },
      });
      const list: FolioRow[] = r.data?.data ?? r.data ?? [];
      return list[0] ?? null;
    },
    enabled: open && !!reservation?.id && !!propertyId,
  });

  const { data: charges = [] } = useQuery<ChargeRow[]>({
    queryKey: ['folio-charges-preview', folio?.id],
    queryFn: async () => {
      const r = await api.get(`/v1/folios/${folio!.id}/charges`);
      return (r.data?.data ?? r.data ?? []) as ChargeRow[];
    },
    enabled: open && !!folio?.id,
  });

  const { data: payments = [] } = useQuery<PaymentRow[]>({
    queryKey: ['folio-payments-preview', folio?.id],
    queryFn: async () => {
      const r = await api.get('/v1/payments', { params: { folioId: folio!.id } });
      return (r.data?.data ?? r.data ?? []) as PaymentRow[];
    },
    enabled: open && !!folio?.id,
  });

  if (!reservation) return null;

  const canEarlyCheckIn = ARRIVAL_STATUSES.has(reservation.status);
  const canMove = MOVE_STATUSES.has(reservation.status);
  const canCheckOut = CHECKOUT_STATUSES.has(reservation.status);
  const vip = profile?.vipLevel ?? reservation.guest?.vipLevel;
  const email = profile?.email ?? reservation.guest?.email;
  const phone = profile?.phone ?? reservation.guest?.phone;
  const nationality = profile?.nationality ?? reservation.guest?.nationality;
  const loyalty = profile?.loyaltyNumber ?? reservation.guest?.loyaltyNumber;
  const balance = folio?.balance ?? reservation.balance ?? 0;
  const recentCharges = charges.filter((c) => !c.isReversed).slice(0, 5);
  const recentPayments = payments.slice(0, 5);

  return (
    <Modal open={open} onClose={onClose} title={t('frontDesk.guestDetails')} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-telivity-navy">{guestLabel(reservation)}</h3>
              {vip && vip !== 'none' && <StatusBadge status={vip} />}
              <StatusBadge status={reservation.status} />
              {guestId && (
                <Link
                  to={`/guests/${guestId}`}
                  className="text-sm font-semibold text-telivity-teal hover:underline"
                >
                  {t('frontDesk.viewProfile', { defaultValue: 'View profile' })}
                </Link>
              )}
            </div>
            <p className="text-sm text-telivity-slate mt-1">
              {reservation.confirmationNumber || '—'}
              {' · '}
              {t('frontDesk.roomNumber', {
                number: reservation.roomNumber ?? t('frontDesk.notAssigned'),
              })}
              {reservation.roomTypeName ? ` — ${reservation.roomTypeName}` : ''}
            </p>
            <p className="text-xs text-telivity-mid-grey mt-0.5">
              {reservation.arrivalDate} → {reservation.departureDate}
            </p>
            {doorPin && (
              <p className="text-sm font-mono text-telivity-navy mt-2">
                {t('frontDesk.doorPin')}: {doorPin}
              </p>
            )}
            {loyalty && (
              <p className="text-xs text-telivity-mid-grey mt-1">
                {t('frontDesk.loyaltyNumber', { defaultValue: 'Loyalty #' })}: {loyalty}
              </p>
            )}
          </div>
        </div>

        <div className="border border-gray-100 rounded-xl p-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-telivity-mid-grey">
            {t('frontDesk.profile', { defaultValue: 'Profile' })}
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-telivity-mid-grey">{t('guests.email', { defaultValue: 'Email' })}</dt>
              <dd className="text-telivity-navy">{email || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-telivity-mid-grey">{t('guests.phone', { defaultValue: 'Phone' })}</dt>
              <dd className="text-telivity-navy">{phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-telivity-mid-grey">
                {t('guests.nationality', { defaultValue: 'Nationality' })}
              </dt>
              <dd className="text-telivity-navy">{nationality || '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-telivity-mid-grey mb-3">
            {t('frontDesk.accompanyingGuests')}
          </p>
          <ReservationPartyPanel
            reservationId={reservation.id}
            propertyId={propertyId}
            roomTypeId={reservation.roomTypeId}
            ratePlanId={reservation.ratePlanId}
            totalAmount={reservation.totalAmount}
          />
        </div>

        <div className="border border-gray-100 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-telivity-mid-grey">
              {t('frontDesk.accountSummary')}
            </p>
            <p className="text-sm text-telivity-navy font-semibold">
              {t('frontDesk.balance')}: ${Number(balance).toFixed(2)}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-telivity-mid-grey mb-1">
                {t('folios.charges', { defaultValue: 'Charges' })}
              </p>
              {recentCharges.length === 0 ? (
                <p className="text-sm text-telivity-mid-grey">
                  {t('folios.noCharges', { defaultValue: 'No charges' })}
                </p>
              ) : (
                <ul className="space-y-1">
                  {recentCharges.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2 text-sm">
                      <span className="text-telivity-slate truncate">{c.description || '—'}</span>
                      <span className="font-medium text-telivity-navy shrink-0">
                        ${Number(c.amount).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-telivity-mid-grey mb-1">
                {t('folios.payments', { defaultValue: 'Payments' })}
              </p>
              {recentPayments.length === 0 ? (
                <p className="text-sm text-telivity-mid-grey">
                  {t('folios.noPayments', { defaultValue: 'No payments' })}
                </p>
              ) : (
                <ul className="space-y-1">
                  {recentPayments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 text-sm">
                      <span className="text-telivity-slate truncate">{p.method || '—'}</span>
                      <span className="font-medium text-telivity-navy shrink-0">
                        ${Number(p.amount).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <Link
            to={folio?.id ? `/folios/${folio.id}` : `/folios?reservationId=${reservation.id}`}
            className="inline-block text-sm text-telivity-teal font-medium hover:underline"
          >
            {t('frontDesk.viewFolio')}
          </Link>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => onNotes(reservation)}
            className="inline-flex items-center gap-1.5 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-light-grey"
          >
            <StickyNote size={14} />
            {t('frontDesk.notes')}
          </button>
          {canMove && (
            <button
              type="button"
              onClick={() => onMove(reservation)}
              className="inline-flex items-center gap-1.5 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-light-grey"
            >
              <ArrowRightLeft size={14} />
              {t('frontDesk.moveRoom')}
            </button>
          )}
          {canEarlyCheckIn && (
            <button
              type="button"
              onClick={() => onCheckIn(reservation)}
              className="inline-flex items-center gap-1.5 border border-telivity-teal/40 text-telivity-teal rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-teal/5"
            >
              <LogIn size={14} />
              {t('frontDesk.earlyCheckIn')}
            </button>
          )}
          {canCheckOut && onCheckOut && (
            <button
              type="button"
              onClick={() => onCheckOut(reservation)}
              className="inline-flex items-center gap-1.5 border border-telivity-orange/40 text-telivity-orange rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-orange/5"
            >
              <LogOut size={14} />
              {t('frontDesk.earlyCheckout', { defaultValue: 'Early checkout' })}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
