import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, LogOut, StickyNote } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import Modal from '../ui/Modal';
import StatusBadge from '../ui/StatusBadge';
import type { Guest } from '../../types/guest';

export interface FrontDeskReservation {
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
  guest?: { firstName: string; lastName: string; vipLevel?: string; loyaltyNumber?: string | null };
  balance?: number;
  doNotMove?: boolean;
}

interface Occupant {
  id: string;
  guestId: string;
  role: 'primary' | 'accompanying';
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

interface FolioSummary {
  id: string;
  balance?: number | string;
  totalCharges?: number | string;
  totalPayments?: number | string;
}

interface GuestDetailsModalProps {
  open: boolean;
  propertyId: string;
  reservation: FrontDeskReservation | null;
  doorPin?: string | null;
  onClose: () => void;
  onNotes: () => void;
  onMove: () => void;
  onEarlyCheckout: () => void;
}

export default function GuestDetailsModal({
  open,
  propertyId,
  reservation,
  doorPin,
  onClose,
  onNotes,
  onMove,
  onEarlyCheckout,
}: GuestDetailsModalProps) {
  const { t } = useTranslation();
  const guestId = reservation?.guestId;

  const { data: guestData } = useQuery({
    queryKey: ['guests', guestId, propertyId],
    queryFn: () => api.get(`/v1/guests/${guestId}`, { params: { propertyId } }).then((r) => r.data),
    enabled: open && !!guestId && !!propertyId,
  });

  const { data: occupantsData } = useQuery({
    queryKey: ['reservation-guests', reservation?.id, propertyId],
    queryFn: () =>
      api
        .get(`/v1/reservations/${reservation!.id}/guests`, { params: { propertyId } })
        .then((r) => r.data),
    enabled: open && !!reservation?.id && !!propertyId,
  });

  const { data: folioData } = useQuery({
    queryKey: ['folios', 'reservation', reservation?.id, propertyId],
    queryFn: () =>
      api
        .get('/v1/folios', {
          params: { propertyId, reservationId: reservation!.id, limit: 5 },
        })
        .then((r) => r.data),
    enabled: open && !!reservation?.id && !!propertyId,
  });

  const guest: Guest | null = guestData?.data ?? guestData ?? null;
  const occupants: Occupant[] = occupantsData?.data ?? occupantsData ?? [];
  const folios: FolioSummary[] = folioData?.data ?? folioData ?? [];
  const folio = folios[0];
  const balance = Number(folio?.balance ?? reservation?.balance ?? 0);
  const charges = Number(folio?.totalCharges ?? 0);
  const payments = Number(folio?.totalPayments ?? 0);

  const displayName =
    reservation?.guestName ??
    (reservation?.guest
      ? `${reservation.guest.firstName} ${reservation.guest.lastName}`
      : guest
        ? `${guest.firstName} ${guest.lastName}`
        : t('frontDesk.unknownGuest'));

  const vipLevel = reservation?.guest?.vipLevel ?? guest?.vipLevel;

  return (
    <Modal open={open && !!reservation} onClose={onClose} title={t('frontDesk.guestDetailsTitle')} wide>
      {reservation && (
        <div className="space-y-5">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-telivity-navy">{displayName}</h3>
              {guestId && (
                <Link
                  to={`/guests/${guestId}`}
                  className="text-xs font-semibold text-telivity-teal hover:underline"
                  onClick={onClose}
                >
                  {t('frontDesk.viewProfile')}
                </Link>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={reservation.status} />
              {vipLevel && vipLevel !== 'none' && <StatusBadge status={vipLevel} />}
            </div>
            <p className="text-xs text-telivity-mid-grey">
              <span className="font-mono text-telivity-navy">{reservation.confirmationNumber}</span>
              {' · '}
              {t('frontDesk.roomNumber', { number: reservation.roomNumber ?? '—' })}
              {reservation.roomTypeName ? ` (${reservation.roomTypeName})` : ''}
              {' · '}
              {reservation.arrivalDate} → {reservation.departureDate}
            </p>
            <p className="text-xs text-telivity-mid-grey">
              {t('frontDesk.doorPin')}:{' '}
              <span className="font-mono text-telivity-navy">{doorPin || t('frontDesk.doorPinNone')}</span>
            </p>
          </header>

          <section className="rounded-xl border border-gray-100 bg-telivity-light-grey/30 p-4 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-telivity-navy">
              {t('frontDesk.profileSection')}
            </h4>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-telivity-mid-grey">{t('common.email')}</dt>
                <dd className="text-telivity-navy">{guest?.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-telivity-mid-grey">{t('common.phone')}</dt>
                <dd className="text-telivity-navy">{guest?.phone || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-telivity-mid-grey">{t('frontDesk.nationality')}</dt>
                <dd className="text-telivity-navy">{guest?.nationality || guest?.countryCode || '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-telivity-navy">
              {t('frontDesk.accompanyingGuests')}
            </h4>
            {occupants.length === 0 ? (
              <p className="text-sm text-telivity-mid-grey">{t('frontDesk.noAccompanyingGuests')}</p>
            ) : (
              <ul className="space-y-2">
                {occupants.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-telivity-navy truncate">
                        {`${o.firstName ?? ''} ${o.lastName ?? ''}`.trim() || o.guestId.slice(0, 8)}
                        {o.role === 'primary' && (
                          <span className="ml-2 text-[10px] uppercase text-telivity-mid-grey">
                            {t('reservations.primaryGuest')}
                          </span>
                        )}
                      </p>
                      {o.email && <p className="text-xs text-telivity-mid-grey truncate">{o.email}</p>}
                    </div>
                    <Link
                      to={`/guests/${o.guestId}`}
                      className="text-xs font-semibold text-telivity-teal hover:underline shrink-0"
                      onClick={onClose}
                    >
                      {t('frontDesk.viewProfile')}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-100 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-telivity-navy">
                {t('frontDesk.accountSummary')}
              </h4>
              <Link
                to={`/folios?reservationId=${reservation.id}`}
                className="text-xs font-semibold text-telivity-teal hover:underline"
                onClick={onClose}
              >
                {t('frontDesk.viewFolio')}
              </Link>
            </div>
            <p className="text-2xl font-semibold text-telivity-navy">${balance.toFixed(2)}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-telivity-mid-grey">{t('folios.charges')}</p>
                <p className="text-telivity-navy">
                  {charges > 0 ? `$${charges.toFixed(2)}` : t('folios.noCharges')}
                </p>
              </div>
              <div>
                <p className="text-xs text-telivity-mid-grey">{t('folios.payments')}</p>
                <p className="text-telivity-navy">
                  {payments > 0 ? `$${payments.toFixed(2)}` : t('folios.noPayments')}
                </p>
              </div>
            </div>
          </section>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={onNotes}
              className="inline-flex items-center gap-1.5 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-xs font-semibold hover:bg-telivity-light-grey"
            >
              <StickyNote size={14} />
              {t('frontDesk.notes')}
            </button>
            <button
              type="button"
              onClick={onMove}
              className="inline-flex items-center gap-1.5 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-xs font-semibold hover:bg-telivity-light-grey"
            >
              <ArrowRightLeft size={14} />
              {t('frontDesk.moveRoom')}
            </button>
            <button
              type="button"
              onClick={onEarlyCheckout}
              className="inline-flex items-center gap-1.5 border border-telivity-orange/30 text-telivity-orange rounded-lg px-3 py-2 text-xs font-semibold hover:bg-telivity-orange/5"
            >
              <LogOut size={14} />
              {t('frontDesk.earlyCheckout')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto bg-telivity-teal text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-telivity-light-teal"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
