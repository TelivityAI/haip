import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConciergeBell, LogIn, Users, LogOut, UserPlus, UsersRound } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

type Tab = 'arrivals' | 'in-house' | 'departures';

interface Reservation {
  id: string;
  confirmationNumber: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  roomId?: string;
  roomNumber?: string;
  roomTypeName?: string;
  guestName?: string;
  guest?: { firstName: string; lastName: string };
  balance?: number;
}

interface Room {
  id: string;
  roomNumber: string;
  roomTypeName?: string;
  status: string;
}

export default function FrontDesk() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [tab, setTab] = useState<Tab>('arrivals');
  const [checkInModal, setCheckInModal] = useState<Reservation | null>(null);
  const [checkOutModal, setCheckOutModal] = useState<Reservation | null>(null);
  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);

  // Check-in form state
  const [idType, setIdType] = useState('passport');
  const [idNumber, setIdNumber] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');

  const { data: arrivals } = useQuery({
    queryKey: ['reservations', 'arrivals', propertyId, today],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'confirmed', arrivalDateFrom: today, arrivalDateTo: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: inHouse } = useQuery({
    queryKey: ['reservations', 'in-house', propertyId],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'checked_in' } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: departureData } = useQuery({
    queryKey: ['reservations', 'departures', propertyId, today],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'checked_in', departureDateFrom: today, departureDateTo: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: availableRooms } = useQuery({
    queryKey: ['rooms', 'available', propertyId],
    queryFn: () => api.get('/v1/rooms/by-status', { params: { propertyId, status: 'guest_ready' } }).then((r) => r.data),
    enabled: !!propertyId && !!checkInModal,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['reservations'] });
    queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };

  const checkInMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      status: string;
      preAssignedRoomId?: string;
      roomId?: string;
      idType?: string;
      idNumber?: string;
    }) => {
      // KB state machine: pending → confirmed → assigned → checked_in.
      // A still-confirmed arrival must be assigned a room before it can check
      // in, otherwise the API rejects the confirmed → checked_in transition.
      if (data.status === 'confirmed') {
        const roomToAssign = data.roomId || data.preAssignedRoomId;
        if (!roomToAssign) {
          throw new Error('Assign a room before checking in this guest.');
        }
        await api.patch(`/v1/reservations/${data.id}/assign-room`, { roomId: roomToAssign });
      }
      return api.patch(`/v1/reservations/${data.id}/check-in`, {
        roomId: data.roomId || undefined,
        idType: data.idType,
        idNumber: data.idNumber,
      });
    },
    onSuccess: () => {
      invalidateAll();
      setCheckInModal(null);
      resetCheckInForm();
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/v1/reservations/${id}/check-out`, {}),
    onSuccess: () => {
      invalidateAll();
      setCheckOutModal(null);
    },
  });

  const expressCheckoutMutation = useMutation({
    mutationFn: (id: string) => api.post(`/v1/reservations/${id}/express-checkout`),
    onSuccess: () => invalidateAll(),
  });

  const groupCheckInMutation = useMutation({
    mutationFn: (reservationIds: string[]) => {
      requirePropertyId(propertyId);
      return api.post(
        '/v1/reservations/group-check-in',
        { reservations: reservationIds.map((reservationId) => ({ reservationId })) },
        { params: { propertyId } },
      );
    },
    onSuccess: () => {
      invalidateAll();
      setSelectedForGroup([]);
    },
  });

  function resetCheckInForm() {
    setIdType('passport');
    setIdNumber('');
    setSelectedRoom('');
  }

  function guestName(r: Reservation) {
    if (r.guestName) return r.guestName;
    if (r.guest) return `${r.guest.firstName} ${r.guest.lastName}`;
    return t('frontDesk.unknownGuest');
  }

  const arrList: Reservation[] = arrivals?.data ?? arrivals ?? [];
  const ihList: Reservation[] = inHouse?.data ?? inHouse ?? [];
  const depList: Reservation[] = departureData?.data ?? departureData ?? [];
  const roomList: Room[] = availableRooms?.data ?? availableRooms ?? [];

  const tabs: { key: Tab; label: string; icon: typeof LogIn; count: number }[] = [
    { key: 'arrivals', label: t('frontDesk.arrivals'), icon: LogIn, count: arrList.length },
    { key: 'in-house', label: t('frontDesk.inHouse'), icon: Users, count: ihList.length },
    { key: 'departures', label: t('frontDesk.departures'), icon: LogOut, count: depList.length },
  ];

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('frontDesk.selectProperty')}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <ConciergeBell size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('frontDesk.title')}</h1>
        <div className="ml-auto flex gap-2">
          {tab === 'arrivals' && selectedForGroup.length > 0 && (
            <button
              onClick={() => groupCheckInMutation.mutate(selectedForGroup)}
              disabled={groupCheckInMutation.isPending}
              className="flex items-center gap-2 bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-deep-blue/90 transition-colors disabled:opacity-50"
            >
              <UsersRound size={16} />
              {t('frontDesk.groupCheckIn', { count: selectedForGroup.length })}
            </button>
          )}
          <button className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors">
            <UserPlus size={16} />
            {t('frontDesk.walkIn')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-telivity-teal text-white'
                : 'text-telivity-slate hover:bg-telivity-light-grey'
            }`}
          >
            <t.icon size={16} />
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${
              tab === t.key ? 'bg-white/20' : 'bg-telivity-light-grey'
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              {tab === 'arrivals' && (
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedForGroup.length === arrList.length && arrList.length > 0}
                    onChange={(e) => setSelectedForGroup(e.target.checked ? arrList.map((r) => r.id) : [])}
                    className="rounded border-gray-300"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('frontDesk.guest')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('frontDesk.confirmation')}</th>
              {tab === 'arrivals' && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('frontDesk.roomType')}</th>
              )}
              {(tab === 'in-house' || tab === 'departures') && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('frontDesk.room')}</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                {tab === 'arrivals' ? t('frontDesk.arrival') : tab === 'departures' ? t('frontDesk.departure') : t('frontDesk.arrival')}
              </th>
              {tab === 'in-house' && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('frontDesk.departure')}</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('common.status')}</th>
              {(tab === 'in-house' || tab === 'departures') && (
                <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('frontDesk.balance')}</th>
              )}
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase tracking-wider">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(tab === 'arrivals' ? arrList : tab === 'in-house' ? ihList : depList).map((r, i) => (
              <tr key={r.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors`}>
                {tab === 'arrivals' && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedForGroup.includes(r.id)}
                      onChange={(e) =>
                        setSelectedForGroup(e.target.checked
                          ? [...selectedForGroup, r.id]
                          : selectedForGroup.filter((id) => id !== r.id)
                        )
                      }
                      className="rounded border-gray-300"
                    />
                  </td>
                )}
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{guestName(r)}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{r.confirmationNumber}</td>
                {tab === 'arrivals' && (
                  <td className="px-4 py-3 text-sm text-telivity-slate">{r.roomTypeName ?? '—'}</td>
                )}
                {(tab === 'in-house' || tab === 'departures') && (
                  <td className="px-4 py-3 text-sm text-telivity-slate">{r.roomNumber ?? '—'}</td>
                )}
                <td className="px-4 py-3 text-sm text-telivity-slate">
                  {tab === 'departures' ? r.departureDate : r.arrivalDate}
                </td>
                {tab === 'in-house' && (
                  <td className="px-4 py-3 text-sm text-telivity-slate">{r.departureDate}</td>
                )}
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                {(tab === 'in-house' || tab === 'departures') && (
                  <td className="px-4 py-3 text-sm text-right font-medium">
                    ${Number(r.balance ?? 0).toFixed(2)}
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  {tab === 'arrivals' && (
                    <button
                      onClick={() => { setCheckInModal(r); resetCheckInForm(); }}
                      className="bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-teal transition-colors"
                    >
                      {t('frontDesk.checkIn')}
                    </button>
                  )}
                  {tab === 'in-house' && (
                    <a
                      href={`/folios?reservationId=${r.id}`}
                      className="text-telivity-teal text-xs font-semibold hover:underline"
                    >
                      {t('frontDesk.viewFolio')}
                    </a>
                  )}
                  {tab === 'departures' && (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setCheckOutModal(r)}
                        className="bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-teal transition-colors"
                      >
                        {t('frontDesk.checkOut')}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(t('frontDesk.expressCheckoutConfirm'))) {
                            expressCheckoutMutation.mutate(r.id);
                          }
                        }}
                        disabled={expressCheckoutMutation.isPending}
                        className="bg-telivity-orange text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-orange-lt transition-colors disabled:opacity-50"
                      >
                        {t('frontDesk.express')}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {(tab === 'arrivals' ? arrList : tab === 'in-house' ? ihList : depList).length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">
                  {t('frontDesk.noToday', { item: tab === 'arrivals' ? t('frontDesk.arrivals').toLowerCase() : tab === 'in-house' ? t('frontDesk.inHouse').toLowerCase() : t('frontDesk.departures').toLowerCase() })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Check-In Modal */}
      <Modal open={!!checkInModal} onClose={() => setCheckInModal(null)} title={t('frontDesk.checkInGuest')} wide>
        {checkInModal && (
          <div className="space-y-4">
            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-sm font-semibold text-telivity-navy">{guestName(checkInModal)}</p>
              <p className="text-xs text-telivity-mid-grey mt-1">
                {checkInModal.confirmationNumber} &middot; {checkInModal.arrivalDate} → {checkInModal.departureDate}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">{t('frontDesk.idDocumentType')}</label>
              <select
                value={idType}
                onChange={(e) => setIdType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="passport">{t('frontDesk.passport')}</option>
                <option value="drivers_license">{t('frontDesk.driversLicense')}</option>
                <option value="national_id">{t('frontDesk.nationalId')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">{t('frontDesk.idNumber')}</label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                placeholder={t('frontDesk.enterIdNumber')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">{t('frontDesk.assignRoom')}</label>
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="">{t('frontDesk.usePreAssignedRoom')}</option>
                {roomList.map((room) => (
                  <option key={room.id} value={room.id}>
                    {t('frontDesk.roomNumber', { number: room.roomNumber })} {room.roomTypeName ? `(${room.roomTypeName})` : ''} — {formatLabel(room.status, t)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setCheckInModal(null)}
                className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => checkInMutation.mutate({
                  id: checkInModal.id,
                  status: checkInModal.status,
                  preAssignedRoomId: checkInModal.roomId,
                  roomId: selectedRoom || undefined,
                  idType,
                  idNumber: idNumber || undefined,
                })}
                disabled={checkInMutation.isPending}
                className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors disabled:opacity-50"
              >
                {checkInMutation.isPending ? t('frontDesk.checkingIn') : t('frontDesk.confirmCheckIn')}
              </button>
            </div>
            {checkInMutation.isError && (
              <p className="text-sm text-telivity-orange">
                {(checkInMutation.error as Error)?.message ?? t('frontDesk.checkInFailed')}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Check-Out Modal */}
      <Modal open={!!checkOutModal} onClose={() => setCheckOutModal(null)} title={t('frontDesk.checkOutGuest')}>
        {checkOutModal && (
          <div className="space-y-4">
            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-sm font-semibold text-telivity-navy">{guestName(checkOutModal)}</p>
              <p className="text-xs text-telivity-mid-grey mt-1">
                {t('frontDesk.roomNumber', { number: checkOutModal.roomNumber ?? '—' })} &middot; {checkOutModal.confirmationNumber}
              </p>
            </div>

            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-xs text-telivity-mid-grey">{t('frontDesk.outstandingBalance')}</p>
              <p className="text-xl font-semibold text-telivity-navy">${Number(checkOutModal.balance ?? 0).toFixed(2)}</p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setCheckOutModal(null)}
                className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => checkOutMutation.mutate(checkOutModal.id)}
                disabled={checkOutMutation.isPending}
                className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors disabled:opacity-50"
              >
                {checkOutMutation.isPending ? t('common.processing') : t('frontDesk.confirmCheckOut')}
              </button>
            </div>
            {checkOutMutation.isError && (
              <p className="text-sm text-telivity-orange">
                {(checkOutMutation.error as Error)?.message ?? t('frontDesk.checkOutFailed')}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function formatLabel(s: string, t: (key: string, options?: Record<string, unknown>) => string) {
  return t(`dashboard.roomStatuses.${s}`, { defaultValue: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) });
}
