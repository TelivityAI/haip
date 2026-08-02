import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, StickyNote, LogIn } from 'lucide-react';
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
  guestName?: string;
  guest?: { firstName: string; lastName: string; vipLevel?: string; loyaltyNumber?: string | null };
  bookingId?: string;
  ratePlanId?: string;
  totalAmount?: string;
  doNotMove?: boolean;
  balance?: number;
}

const ARRIVAL_STATUSES = new Set(['confirmed', 'assigned']);
const IN_HOUSE_STATUSES = new Set(['checked_in', 'stayover', 'due_out']);

export default function GuestDetailsModal({
  open,
  reservation,
  propertyId,
  doorPin,
  onClose,
  onNotes,
  onMove,
  onCheckIn,
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
  guestLabel: (r: GuestDetailsReservation) => string;
}) {
  const { t } = useTranslation();
  if (!reservation) return null;

  const canEarlyCheckIn = ARRIVAL_STATUSES.has(reservation.status);
  const canMove = IN_HOUSE_STATUSES.has(reservation.status);
  const vip = reservation.guest?.vipLevel;

  return (
    <Modal open={open} onClose={onClose} title={t('frontDesk.guestDetails')} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-telivity-navy">{guestLabel(reservation)}</h3>
              {vip && vip !== 'none' && <StatusBadge status={vip} />}
              <StatusBadge status={reservation.status} />
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
          </div>
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

        <div className="border border-gray-100 rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-telivity-mid-grey mb-2">
            {t('frontDesk.accountSummary')}
          </p>
          <p className="text-sm text-telivity-navy font-semibold">
            {t('frontDesk.balance')}: ${Number(reservation.balance ?? 0).toFixed(2)}
          </p>
          <a
            href={`/folios?reservationId=${reservation.id}`}
            className="inline-block mt-2 text-sm text-telivity-teal font-medium hover:underline"
          >
            {t('frontDesk.viewFolio')}
          </a>
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
