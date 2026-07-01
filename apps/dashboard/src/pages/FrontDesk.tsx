import { useState } from 'react';
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
    mutationFn: (data: { id: string; roomId?: string; idType?: string; idNumber?: string }) =>
      api.patch(`/v1/reservations/${data.id}/check-in`, {
        roomId: data.roomId || undefined,
        idType: data.idType,
        idNumber: data.idNumber,
      }),
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
    return 'Unknown Guest';
  }

  const arrList: Reservation[] = arrivals?.data ?? arrivals ?? [];
  const ihList: Reservation[] = inHouse?.data ?? inHouse ?? [];
  const depList: Reservation[] = departureData?.data ?? departureData ?? [];
  const roomList: Room[] = availableRooms?.data ?? availableRooms ?? [];

  const tabs: { key: Tab; label: string; icon: typeof LogIn; count: number }[] = [
    { key: 'arrivals', label: 'Arrivals', icon: LogIn, count: arrList.length },
    { key: 'in-house', label: 'In-House', icon: Users, count: ihList.length },
    { key: 'departures', label: 'Departures', icon: LogOut, count: depList.length },
  ];

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        Select a property to view the front desk
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <ConciergeBell size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Front Desk</h1>
        <div className="ml-auto flex gap-2">
          {tab === 'arrivals' && selectedForGroup.length > 0 && (
            <button
              onClick={() => groupCheckInMutation.mutate(selectedForGroup)}
              disabled={groupCheckInMutation.isPending}
              className="flex items-center gap-2 bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-deep-blue/90 transition-colors disabled:opacity-50"
            >
              <UsersRound size={16} />
              Group Check-In ({selectedForGroup.length})
            </button>
          )}
          <button className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors">
            <UserPlus size={16} />
            Walk-In
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
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Guest</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Confirmation</th>
              {tab === 'arrivals' && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Room Type</th>
              )}
              {(tab === 'in-house' || tab === 'departures') && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Room</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                {tab === 'arrivals' ? 'Arrival' : tab === 'departures' ? 'Departure' : 'Arrival'}
              </th>
              {tab === 'in-house' && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Departure</th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Status</th>
              {(tab === 'in-house' || tab === 'departures') && (
                <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase tracking-wider">Balance</th>
              )}
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase tracking-wider">Actions</th>
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
                      Check In
                    </button>
                  )}
                  {tab === 'in-house' && (
                    <a
                      href={`/folios?reservationId=${r.id}`}
                      className="text-telivity-teal text-xs font-semibold hover:underline"
                    >
                      View Folio
                    </a>
                  )}
                  {tab === 'departures' && (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setCheckOutModal(r)}
                        className="bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-teal transition-colors"
                      >
                        Check Out
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Express checkout? This will auto-settle the folio.')) {
                            expressCheckoutMutation.mutate(r.id);
                          }
                        }}
                        disabled={expressCheckoutMutation.isPending}
                        className="bg-telivity-orange text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-orange-lt transition-colors disabled:opacity-50"
                      >
                        Express
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {(tab === 'arrivals' ? arrList : tab === 'in-house' ? ihList : depList).length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">
                  No {tab === 'arrivals' ? 'arrivals' : tab === 'in-house' ? 'in-house guests' : 'departures'} for today
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Check-In Modal */}
      <Modal open={!!checkInModal} onClose={() => setCheckInModal(null)} title="Check In Guest" wide>
        {checkInModal && (
          <div className="space-y-4">
            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-sm font-semibold text-telivity-navy">{guestName(checkInModal)}</p>
              <p className="text-xs text-telivity-mid-grey mt-1">
                {checkInModal.confirmationNumber} &middot; {checkInModal.arrivalDate} → {checkInModal.departureDate}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">ID Document Type</label>
              <select
                value={idType}
                onChange={(e) => setIdType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="passport">Passport</option>
                <option value="drivers_license">Driver's License</option>
                <option value="national_id">National ID</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">ID Number</label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                placeholder="Enter ID number"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">Assign Room</label>
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="">Use pre-assigned room</option>
                {roomList.map((room) => (
                  <option key={room.id} value={room.id}>
                    Room {room.roomNumber} {room.roomTypeName ? `(${room.roomTypeName})` : ''} — {formatLabel(room.status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setCheckInModal(null)}
                className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => checkInMutation.mutate({
                  id: checkInModal.id,
                  roomId: selectedRoom || undefined,
                  idType,
                  idNumber: idNumber || undefined,
                })}
                disabled={checkInMutation.isPending}
                className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors disabled:opacity-50"
              >
                {checkInMutation.isPending ? 'Checking in...' : 'Confirm Check-In'}
              </button>
            </div>
            {checkInMutation.isError && (
              <p className="text-sm text-telivity-orange">
                {(checkInMutation.error as Error)?.message ?? 'Check-in failed'}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Check-Out Modal */}
      <Modal open={!!checkOutModal} onClose={() => setCheckOutModal(null)} title="Check Out Guest">
        {checkOutModal && (
          <div className="space-y-4">
            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-sm font-semibold text-telivity-navy">{guestName(checkOutModal)}</p>
              <p className="text-xs text-telivity-mid-grey mt-1">
                Room {checkOutModal.roomNumber ?? '—'} &middot; {checkOutModal.confirmationNumber}
              </p>
            </div>

            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-xs text-telivity-mid-grey">Outstanding Balance</p>
              <p className="text-xl font-semibold text-telivity-navy">${Number(checkOutModal.balance ?? 0).toFixed(2)}</p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setCheckOutModal(null)}
                className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => checkOutMutation.mutate(checkOutModal.id)}
                disabled={checkOutMutation.isPending}
                className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors disabled:opacity-50"
              >
                {checkOutMutation.isPending ? 'Processing...' : 'Confirm Check-Out'}
              </button>
            </div>
            {checkOutMutation.isError && (
              <p className="text-sm text-telivity-orange">
                {(checkOutMutation.error as Error)?.message ?? 'Check-out failed'}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function formatLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
