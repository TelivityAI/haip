import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarDays, X } from 'lucide-react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { api } from '../../lib/api';
import { moneyString, requirePropertyId } from '../../lib/api-helpers';
import Modal from '../ui/Modal';
import FindGuest from '../guests/FindGuest';
import type { Guest } from '../../types/guest';
import { planWalkInAssignments } from './walk-in-plan';

interface Room {
  id: string;
  number?: string;
  roomNumber?: string;
  roomTypeId?: string;
  status: string;
}

interface RoomType {
  id: string;
  name: string;
}

interface RatePlan {
  id: string;
  name: string;
  roomTypeId?: string;
  baseAmount?: string | number;
  currencyCode?: string;
  isActive?: boolean;
}

interface WalkInOccupant {
  key: string;
  guest: Guest;
  roomId: string;
}

export interface WalkInCreated {
  reservationId: string;
  roomId: string;
  arrivalDate: string;
  departureDate: string;
  guestName: string;
}

interface WalkInModalProps {
  open: boolean;
  propertyId: string;
  onClose: () => void;
  onCreated: (created: WalkInCreated) => void;
}

function roomLabel(room: Room) {
  return room.roomNumber ?? room.number ?? room.id.slice(0, 8);
}

function formatRoomStatus(
  status: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return t(`dashboard.roomStatuses.${status}`, {
    defaultValue: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  });
}

export default function WalkInModal({ open, propertyId, onClose, onCreated }: WalkInModalProps) {
  const { t } = useTranslation();
  const today = format(new Date(), 'yyyy-MM-dd');
  const defaultDeparture = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const [occupants, setOccupants] = useState<WalkInOccupant[]>([]);
  const [arrivalDate, setArrivalDate] = useState(today);
  const [departureDate, setDepartureDate] = useState(defaultDeparture);
  const [roomTypeId, setRoomTypeId] = useState('');
  const [ratePlanId, setRatePlanId] = useState('');
  const [error, setError] = useState('');

  const nights = useMemo(() => {
    try {
      const n = differenceInCalendarDays(parseISO(departureDate), parseISO(arrivalDate));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }, [arrivalDate, departureDate]);

  const { data: availableRooms } = useQuery({
    queryKey: ['rooms', 'available', propertyId],
    queryFn: () =>
      api.get('/v1/rooms/by-status', { params: { propertyId, status: 'guest_ready' } }).then((r) => r.data),
    enabled: !!propertyId && open,
  });

  const { data: roomTypes } = useQuery({
    queryKey: ['room-types', propertyId],
    queryFn: () => api.get('/v1/room-types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && open,
  });

  const { data: ratePlans } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && open,
  });

  const roomList: Room[] = useMemo(() => {
    const raw = availableRooms?.data ?? availableRooms ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [availableRooms]);

  const rtList: RoomType[] = Array.isArray(roomTypes) ? roomTypes : roomTypes?.data ?? [];
  const rpList: RatePlan[] = Array.isArray(ratePlans) ? ratePlans : ratePlans?.data ?? [];
  const filteredPlans = roomTypeId
    ? rpList.filter((p) => p.roomTypeId === roomTypeId && p.isActive !== false)
    : rpList;
  const typedRooms = roomTypeId
    ? roomList.filter((r) => !r.roomTypeId || r.roomTypeId === roomTypeId)
    : roomList;

  const selectedPlan = filteredPlans.find((p) => p.id === ratePlanId);
  const nightly = Number(selectedPlan?.baseAmount ?? 0);
  const stayTotal = nightly * Math.max(nights, 0);

  function reset() {
    setOccupants([]);
    setArrivalDate(today);
    setDepartureDate(defaultDeparture);
    setRoomTypeId('');
    setRatePlanId('');
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function addOccupant(guest: Guest | null) {
    if (!guest) return;
    setOccupants((prev) => {
      if (prev.some((o) => o.guest.id === guest.id)) return prev;
      return [...prev, { key: `${guest.id}-${Date.now()}`, guest, roomId: '' }];
    });
  }

  function removeOccupant(key: string) {
    setOccupants((prev) => prev.filter((o) => o.key !== key));
  }

  function setOccupantRoom(key: string, roomId: string) {
    setOccupants((prev) => prev.map((o) => (o.key === key ? { ...o, roomId } : o)));
  }

  // Same room = accompanying on one reservation; different rooms = split under
  // the same booking. Keep every guest-ready room of the type selectable.
  function roomsForOccupant() {
    return typedRooms;
  }

  const mutation = useMutation({
    mutationFn: async () => {
      requirePropertyId(propertyId);
      setError('');

      if (occupants.length === 0 || !roomTypeId || !ratePlanId || nights <= 0) {
        throw new Error(t('frontDesk.walkInRequired'));
      }
      if (occupants.some((o) => !o.roomId)) {
        throw new Error(t('frontDesk.walkInRoomRequired'));
      }

      const amount = moneyString(stayTotal);
      const currencyCode = selectedPlan?.currencyCode ?? 'USD';
      const steps = planWalkInAssignments(
        occupants.map((o) => ({ guestId: o.guest.id, roomId: o.roomId })),
      );
      const primaryStep = steps.find((s) => s.type === 'create_primary');
      if (!primaryStep || primaryStep.type !== 'create_primary') {
        throw new Error(t('frontDesk.walkInRequired'));
      }
      const primaryGuest = occupants.find((o) => o.guest.id === primaryStep.guestId)!.guest;

      const resCreate = await api.post(
        '/v1/reservations',
        {
          propertyId,
          guestId: primaryStep.guestId,
          roomTypeId,
          ratePlanId,
          arrivalDate,
          departureDate,
          adults: 1,
          source: 'walk_in',
          totalAmount: amount,
          currencyCode,
        },
        { skipErrorToast: true },
      );
      const primaryReservationId = resCreate.data.id ?? resCreate.data.reservation?.id;
      if (!primaryReservationId) {
        throw new Error(t('frontDesk.walkInFailed'));
      }

      await api.patch(
        `/v1/reservations/${primaryReservationId}/confirm`,
        {},
        { params: { propertyId }, skipErrorToast: true },
      );
      await api.patch(
        `/v1/reservations/${primaryReservationId}/assign-room`,
        { roomId: primaryStep.roomId },
        { params: { propertyId }, skipErrorToast: true },
      );

      // Map roomId → reservationId so same-room accompanying guests attach
      // to the correct sibling after a split.
      const roomToReservation = new Map<string, string>([
        [primaryStep.roomId, primaryReservationId],
      ]);

      for (const step of steps) {
        if (step.type === 'create_primary') continue;

        if (step.type === 'add_accompanying') {
          const targetReservationId = roomToReservation.get(step.roomId) ?? primaryReservationId;
          await api.post(
            `/v1/reservations/${targetReservationId}/guests`,
            { guestId: step.guestId },
            { params: { propertyId }, skipErrorToast: true },
          );
          continue;
        }

        // Add onto primary, then split onto the new room under the same booking.
        await api.post(
          `/v1/reservations/${primaryReservationId}/guests`,
          { guestId: step.guestId },
          { params: { propertyId }, skipErrorToast: true },
        );
        const splitRes = await api.post(
          `/v1/reservations/${primaryReservationId}/split`,
          {
            guestIds: [step.guestId],
            roomTypeId,
            ratePlanId,
            totalAmount: amount,
            currencyCode,
            roomId: step.roomId,
            adults: 1,
          },
          { params: { propertyId }, skipErrorToast: true },
        );
        const newReservationId =
          splitRes.data?.reservation?.id ?? splitRes.data?.reservationId ?? splitRes.data?.id;
        if (newReservationId) {
          roomToReservation.set(step.roomId, newReservationId);
        }
      }

      return {
        reservationId: primaryReservationId as string,
        roomId: primaryStep.roomId,
        arrivalDate,
        departureDate,
        guestName: `${primaryGuest.firstName} ${primaryGuest.lastName}`.trim(),
      } satisfies WalkInCreated;
    },
    onSuccess: (created) => {
      reset();
      onCreated(created);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? err?.message ?? t('frontDesk.walkInFailed'));
    },
  });

  return (
    <Modal open={open} onClose={handleClose} title={t('frontDesk.walkInTitle')} wide>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider">
            {t('frontDesk.guestsOccupants', { count: occupants.length })}
          </h3>

          {occupants.length === 0 && (
            <FindGuest
              label={t('reservations.guest')}
              selectedGuest={null}
              onSelectGuest={addOccupant}
            />
          )}

          <ul className="space-y-2">
            {occupants.map((o) => (
              <li
                key={o.key}
                className="rounded-xl border border-gray-100 bg-telivity-light-grey/40 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-telivity-navy truncate">
                      {o.guest.firstName} {o.guest.lastName}
                    </p>
                    {o.guest.email && (
                      <p className="text-xs text-telivity-mid-grey truncate">{o.guest.email}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeOccupant(o.key)}
                    className="p-1 rounded-lg text-telivity-mid-grey hover:bg-white hover:text-telivity-orange"
                    aria-label={t('common.remove')}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-telivity-mid-grey mb-1">
                    {t('frontDesk.room')}
                  </label>
                  <select
                    value={o.roomId}
                    onChange={(e) => setOccupantRoom(o.key, e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">{t('frontDesk.selectRoom')}</option>
                    {roomsForOccupant().map((room) => (
                      <option key={room.id} value={room.id}>
                        {roomLabel(room)} ({formatRoomStatus(room.status, t)})
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>

          {occupants.length > 0 && (
            <div className="rounded-xl border border-telivity-teal/20 bg-telivity-teal/5 p-3">
              <FindGuest
                label={t('frontDesk.addAccompanyingGuest')}
                selectedGuest={null}
                onSelectGuest={addOccupant}
                placeholder={t('guests.searchOrRegister')}
              />
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-telivity-navy uppercase tracking-wider">
            <CalendarDays size={14} className="text-telivity-teal" />
            <span>
              {t('frontDesk.walkInStay', {
                checkIn: arrivalDate,
                checkOut: departureDate,
                count: Math.max(nights, 0),
              })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('frontDesk.arrivalDate')}
              </label>
              <input
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('frontDesk.departureDate')}
              </label>
              <input
                type="date"
                value={departureDate}
                min={arrivalDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('frontDesk.roomType')}
            </label>
            <select
              value={roomTypeId}
              onChange={(e) => {
                setRoomTypeId(e.target.value);
                setRatePlanId('');
                setOccupants((prev) => prev.map((o) => ({ ...o, roomId: '' })));
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('frontDesk.selectRoomType')}</option>
              {rtList.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('frontDesk.ratePlan')}
            </label>
            <select
              value={ratePlanId}
              onChange={(e) => setRatePlanId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('frontDesk.selectRatePlan')}</option>
              {filteredPlans.map((rp) => {
                const base = Number(rp.baseAmount ?? 0);
                const total = base * Math.max(nights, 0);
                return (
                  <option key={rp.id} value={rp.id}>
                    {rp.name} — {moneyString(base)}
                    {nights > 0 ? ` (${nights} d = ${moneyString(total)})` : ''}
                  </option>
                );
              })}
            </select>
          </div>
        </section>

        {error && <p className="text-sm text-telivity-orange">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {mutation.isPending ? t('common.processing') : t('frontDesk.createWalkIn')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
