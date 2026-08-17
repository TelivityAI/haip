import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Split, ArrowRightLeft, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { moneyString, requirePropertyId, requireCurrency } from '../../lib/api-helpers';
import { useToast } from '../ui/Toast';
import FindGuest from '../guests/FindGuest';
import type { Guest } from '../../types/guest';
import Modal from '../ui/Modal';

interface Occupant {
  id: string;
  guestId: string;
  role: 'primary' | 'accompanying';
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

interface SiblingReservation {
  id: string;
  status: string;
  roomNumber?: string | null;
  roomTypeName?: string | null;
  guestName?: string | null;
  roomTypeId: string;
  ratePlanId: string;
  totalAmount?: string;
}

interface RoomType {
  id: string;
  name: string;
  maxOccupancy?: number;
}

interface RatePlan {
  id: string;
  name: string;
}

interface Room {
  id: string;
  number: string;
  roomTypeId: string;
  status: string;
}

export default function ReservationPartyPanel({
  reservationId,
  propertyId,
  roomTypeId,
  ratePlanId,
  totalAmount,
  currencyCode,
}: {
  reservationId: string;
  propertyId: string;
  roomTypeId?: string;
  ratePlanId?: string;
  totalAmount?: string;
  currencyCode?: string | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addOverrideOccupancy, setAddOverrideOccupancy] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [moveGuestId, setMoveGuestId] = useState<string | null>(null);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [splitGuestIds, setSplitGuestIds] = useState<string[]>([]);
  const [splitRoomTypeId, setSplitRoomTypeId] = useState(roomTypeId ?? '');
  const [splitRatePlanId, setSplitRatePlanId] = useState(ratePlanId ?? '');
  const [splitRoomId, setSplitRoomId] = useState('');
  const [splitAmount, setSplitAmount] = useState(
    totalAmount ? String(Number(totalAmount) / 2) : '0.00',
  );
  const [splitOverrideOccupancy, setSplitOverrideOccupancy] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveOverrideOccupancy, setMoveOverrideOccupancy] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['reservation-guests', reservationId] });
    queryClient.invalidateQueries({ queryKey: ['booking-siblings', reservationId] });
    queryClient.invalidateQueries({ queryKey: ['reservations'] });
  };

  const { data: occupants = [], isLoading } = useQuery<Occupant[]>({
    queryKey: ['reservation-guests', reservationId, propertyId],
    queryFn: () =>
      api
        .get(`/v1/reservations/${reservationId}/guests`, { params: { propertyId } })
        .then((r) => (r.data?.data ?? r.data ?? []) as Occupant[]),
    enabled: !!reservationId && !!propertyId,
  });

  const { data: siblings = [] } = useQuery<SiblingReservation[]>({
    queryKey: ['booking-siblings', reservationId, propertyId],
    queryFn: () =>
      api
        .get(`/v1/reservations/${reservationId}/booking-siblings`, { params: { propertyId } })
        .then((r) => (r.data?.data ?? r.data ?? []) as SiblingReservation[]),
    enabled: !!reservationId && !!propertyId,
  });

  const { data: roomTypes = [] } = useQuery<RoomType[]>({
    queryKey: ['room-types', propertyId],
    queryFn: () =>
      api
        .get('/v1/rooms/types', { params: { propertyId } })
        .then((r) => (r.data?.data ?? r.data ?? []) as RoomType[]),
    enabled: !!propertyId && (splitOpen || addOpen),
  });

  const { data: ratePlans = [] } = useQuery<RatePlan[]>({
    queryKey: ['rate-plans', propertyId],
    queryFn: () =>
      api
        .get('/v1/rate-plans', { params: { propertyId } })
        .then((r) => (r.data?.data ?? r.data ?? []) as RatePlan[]),
    enabled: !!propertyId && splitOpen,
  });

  const { data: rooms = [] } = useQuery<Room[]>({
    queryKey: ['rooms', propertyId, splitRoomTypeId],
    queryFn: () =>
      api
        .get('/v1/rooms', { params: { propertyId, roomTypeId: splitRoomTypeId || undefined } })
        .then((r) => (r.data?.data ?? r.data ?? []) as Room[]),
    enabled: !!propertyId && splitOpen && !!splitRoomTypeId,
  });

  const addMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      if (!selectedGuest) throw new Error('guest required');
      return api.post(
        `/v1/reservations/${reservationId}/guests`,
        { guestId: selectedGuest.id, overrideMaxOccupancy: addOverrideOccupancy },
        { params: { propertyId } },
      );
    },
    onSuccess: () => {
      toast('success', t('reservations.guestAdded'));
      setAddOpen(false);
      setSelectedGuest(null);
      setAddOverrideOccupancy(false);
      invalidate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (guestId: string) =>
      api.delete(`/v1/reservations/${reservationId}/guests/${guestId}`, {
        params: { propertyId },
      }),
    onSuccess: () => {
      toast('success', t('reservations.guestRemoved'));
      invalidate();
    },
  });

  const splitMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      requireCurrency(currencyCode ?? null);
      return api.post(
        `/v1/reservations/${reservationId}/split`,
        {
          guestIds: splitGuestIds,
          roomTypeId: splitRoomTypeId,
          ratePlanId: splitRatePlanId,
          totalAmount: moneyString(splitAmount),
          currencyCode,
          roomId: splitRoomId || undefined,
          adults: Math.max(1, splitGuestIds.length),
          overrideMaxOccupancy: splitOverrideOccupancy,
        },
        { params: { propertyId } },
      );
    },
    onSuccess: () => {
      toast('success', t('reservations.splitSuccess'));
      setSplitOpen(false);
      setSplitGuestIds([]);
      setSplitOverrideOccupancy(false);
      invalidate();
    },
  });

  const moveMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      if (!moveGuestId || !moveTargetId) throw new Error('target required');
      return api.post(
        `/v1/reservations/${reservationId}/guests/${moveGuestId}/move`,
        {
          targetReservationId: moveTargetId,
          overrideMaxOccupancy: moveOverrideOccupancy,
        },
        { params: { propertyId } },
      );
    },
    onSuccess: () => {
      toast('success', t('reservations.guestMoved'));
      setMoveGuestId(null);
      setMoveTargetId('');
      setMoveOverrideOccupancy(false);
      invalidate();
    },
  });

  const otherSiblings = siblings.filter((s) => s.id !== reservationId);
  const guestLabel = (o: Occupant) =>
    `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim() || o.guestId.slice(0, 8);

  const toggleSplitGuest = (guestId: string) => {
    setSplitGuestIds((prev) =>
      prev.includes(guestId) ? prev.filter((id) => id !== guestId) : [...prev, guestId],
    );
  };

  const assignableRooms = rooms.filter((r) =>
    ['guest_ready', 'vacant_clean'].includes(r.status),
  );

  return (
    <div className="space-y-3 border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-telivity-navy">{t('reservations.roomGuests')}</h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-telivity-slate hover:bg-telivity-light-grey"
            title={t('reservations.addGuest')}
          >
            <UserPlus size={14} />
            {t('reservations.addGuest')}
          </button>
          <button
            type="button"
            onClick={() => {
              setSplitRoomTypeId(roomTypeId ?? '');
              setSplitRatePlanId(ratePlanId ?? '');
              setSplitOpen(true);
            }}
            disabled={occupants.length < 2}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-telivity-slate hover:bg-telivity-light-grey disabled:opacity-40"
            title={t('reservations.splitToRoom')}
          >
            <Split size={14} />
            {t('reservations.splitToRoom')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-telivity-mid-grey">{t('common.loading')}</p>
      ) : (
        <ul className="space-y-2">
          {occupants.map((o) => (
            <li
              key={o.guestId}
              className="flex items-center justify-between rounded-lg bg-telivity-light-grey/60 px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-telivity-navy">{guestLabel(o)}</p>
                <p className="text-xs text-telivity-mid-grey">
                  {o.role === 'primary'
                    ? t('reservations.primaryGuest')
                    : t('reservations.accompanyingGuest')}
                </p>
                <Link
                  to={`/guests/${o.guestId}`}
                  className="text-xs font-semibold text-telivity-teal hover:underline"
                >
                  {t('frontDesk.viewProfile', { defaultValue: 'View profile' })}
                </Link>
              </div>
              <div className="flex items-center gap-1">
                {occupants.length > 1 && otherSiblings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMoveGuestId(o.guestId);
                      setMoveTargetId(otherSiblings[0]?.id ?? '');
                    }}
                    className="rounded p-1.5 text-telivity-slate hover:bg-white"
                    title={t('reservations.moveGuest')}
                  >
                    <ArrowRightLeft size={14} />
                  </button>
                )}
                {o.role !== 'primary' && (
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(o.guestId)}
                    className="rounded p-1.5 text-telivity-orange hover:bg-white"
                    title={t('reservations.removeGuest')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
          {occupants.length === 0 && (
            <li className="text-xs text-telivity-mid-grey">{t('reservations.noNamedGuests')}</li>
          )}
        </ul>
      )}

      {otherSiblings.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-telivity-mid-grey">
            {t('reservations.siblingRooms')}
          </p>
          <ul className="space-y-1">
            {otherSiblings.map((s) => (
              <li key={s.id} className="text-xs text-telivity-slate">
                {s.roomNumber
                  ? t('reservations.siblingRoomLine', {
                      room: s.roomNumber,
                      guest: s.guestName ?? '—',
                      status: s.status,
                    })
                  : t('reservations.siblingUnassignedLine', {
                      type: s.roomTypeName ?? '—',
                      guest: s.guestName ?? '—',
                      status: s.status,
                    })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setSelectedGuest(null);
          setAddOverrideOccupancy(false);
        }}
        title={t('reservations.addGuest')}
      >
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('reservations.addGuestHint')}</p>
          <FindGuest selectedGuest={selectedGuest} onSelectGuest={setSelectedGuest} />
          <label className="flex items-center gap-2 text-xs text-telivity-slate">
            <input
              type="checkbox"
              checked={addOverrideOccupancy}
              onChange={(e) => setAddOverrideOccupancy(e.target.checked)}
            />
            {t('reservations.overrideMaxOccupancy')}
          </label>
          <button
            type="button"
            disabled={!selectedGuest || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            className="w-full rounded-lg bg-telivity-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {addMutation.isPending ? t('common.saving') : t('reservations.addGuest')}
          </button>
        </div>
      </Modal>

      <Modal
        open={splitOpen}
        onClose={() => {
          setSplitOpen(false);
          setSplitOverrideOccupancy(false);
        }}
        title={t('reservations.splitToRoom')}
        wide
      >
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('reservations.splitHint')}</p>
          <div>
            <p className="mb-1 text-xs font-medium text-telivity-mid-grey">
              {t('reservations.guestsToMove')}
            </p>
            <div className="space-y-1">
              {occupants.map((o) => (
                <label key={o.guestId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={splitGuestIds.includes(o.guestId)}
                    onChange={() => toggleSplitGuest(o.guestId)}
                    disabled={
                      occupants.length > 1 &&
                      splitGuestIds.length >= occupants.length - 1 &&
                      !splitGuestIds.includes(o.guestId)
                    }
                  />
                  {guestLabel(o)}
                  {o.role === 'primary' ? ` (${t('reservations.primaryGuest')})` : ''}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-telivity-mid-grey">
                {t('reservations.roomType')}
              </label>
              <select
                value={splitRoomTypeId}
                onChange={(e) => {
                  setSplitRoomTypeId(e.target.value);
                  setSplitRoomId('');
                }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">{t('common.select', { defaultValue: 'Select' })}</option>
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-telivity-mid-grey">
                {t('reservations.ratePlan')}
              </label>
              <select
                value={splitRatePlanId}
                onChange={(e) => setSplitRatePlanId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">{t('common.select', { defaultValue: 'Select' })}</option>
                {ratePlans.map((rp) => (
                  <option key={rp.id} value={rp.id}>
                    {rp.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-telivity-mid-grey">
                {t('reservations.roomOptional')}
              </label>
              <select
                value={splitRoomId}
                onChange={(e) => setSplitRoomId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">{t('reservations.unassigned')}</option>
                {assignableRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} ({r.status})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-telivity-mid-grey">
                {t('reservations.total')}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={splitAmount}
                onChange={(e) => setSplitAmount(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-telivity-slate">
            <input
              type="checkbox"
              checked={splitOverrideOccupancy}
              onChange={(e) => setSplitOverrideOccupancy(e.target.checked)}
            />
            {t('reservations.overrideMaxOccupancy')}
          </label>
          <button
            type="button"
            disabled={
              splitGuestIds.length === 0 ||
              !splitRoomTypeId ||
              !splitRatePlanId ||
              splitMutation.isPending
            }
            onClick={() => splitMutation.mutate()}
            className="w-full rounded-lg bg-telivity-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {splitMutation.isPending ? t('common.saving') : t('reservations.confirmSplit')}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!moveGuestId}
        onClose={() => {
          setMoveGuestId(null);
          setMoveTargetId('');
          setMoveOverrideOccupancy(false);
        }}
        title={t('reservations.moveGuest')}
      >
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('reservations.moveGuestHint')}</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-telivity-mid-grey">
              {t('reservations.targetRoom')}
            </label>
            <select
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {otherSiblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.roomNumber
                    ? `#${s.roomNumber} — ${s.guestName ?? '—'}`
                    : `${s.roomTypeName ?? '—'} — ${s.guestName ?? '—'}`}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-telivity-slate">
            <input
              type="checkbox"
              checked={moveOverrideOccupancy}
              onChange={(e) => setMoveOverrideOccupancy(e.target.checked)}
            />
            {t('reservations.overrideMaxOccupancy')}
          </label>
          <button
            type="button"
            disabled={!moveTargetId || moveMutation.isPending}
            onClick={() => moveMutation.mutate()}
            className="w-full rounded-lg bg-telivity-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {moveMutation.isPending ? t('common.saving') : t('reservations.confirmMoveGuest')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
