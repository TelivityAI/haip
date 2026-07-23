import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConciergeBell, LogIn, Users, LogOut, UserPlus, UsersRound, ArrowRightLeft, StickyNote } from 'lucide-react';
import { addDays, format } from 'date-fns';
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
  roomTypeId?: string;
  roomTypeName?: string;
  guestName?: string;
  guest?: { firstName: string; lastName: string };
  balance?: number;
  doNotMove?: boolean;
  totalAmount?: string;
  ratePlanId?: string;
}

interface Room {
  id: string;
  number?: string;
  roomNumber?: string;
  roomTypeId?: string;
  roomTypeName?: string;
  status: string;
}

interface NoteRow {
  id: string;
  body: string;
  isActive: boolean;
  createdAt: string;
}

export default function FrontDesk() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const [tab, setTab] = useState<Tab>('arrivals');
  const [checkInModal, setCheckInModal] = useState<Reservation | null>(null);
  const [checkOutModal, setCheckOutModal] = useState<Reservation | null>(null);
  const [moveModal, setMoveModal] = useState<Reservation | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [notesModal, setNotesModal] = useState<Reservation | null>(null);
  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);

  // Check-in form
  const [idType, setIdType] = useState('passport');
  const [idNumber, setIdNumber] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [registrationSigned, setRegistrationSigned] = useState(false);
  const [regAddress, setRegAddress] = useState('');
  const [regNationality, setRegNationality] = useState('');

  // Move form
  const [moveRoomId, setMoveRoomId] = useState('');
  const [overrideDoNotMove, setOverrideDoNotMove] = useState(false);
  const [moveReason, setMoveReason] = useState('');

  // Walk-in form
  const [wiFirst, setWiFirst] = useState('');
  const [wiLast, setWiLast] = useState('');
  const [wiEmail, setWiEmail] = useState('');
  const [wiRoomTypeId, setWiRoomTypeId] = useState('');
  const [wiRatePlanId, setWiRatePlanId] = useState('');
  const [wiRoomId, setWiRoomId] = useState('');
  const [wiError, setWiError] = useState('');

  // Notes
  const [noteBody, setNoteBody] = useState('');

  const { data: arrivals } = useQuery({
    queryKey: ['reservations', 'arrivals', propertyId, today],
    queryFn: () =>
      api
        .get('/v1/reservations', {
          params: {
            propertyId,
            statuses: 'confirmed,assigned',
            arrivalDateFrom: today,
            arrivalDateTo: today,
            limit: 100,
          },
        })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: unassigned } = useQuery({
    queryKey: ['reservations', 'unassigned', propertyId, today],
    queryFn: () =>
      api
        .get('/v1/reservations/unassigned', {
          params: { propertyId, arrivalDateFrom: today, arrivalDateTo: today },
        })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: inHouse } = useQuery({
    queryKey: ['reservations', 'in-house', propertyId],
    queryFn: () =>
      api
        .get('/v1/reservations', {
          params: { propertyId, statuses: 'checked_in,stayover,due_out', limit: 100 },
        })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: departureData } = useQuery({
    queryKey: ['reservations', 'departures', propertyId, today],
    queryFn: () =>
      api
        .get('/v1/reservations', {
          params: {
            propertyId,
            statuses: 'checked_in,stayover,due_out',
            departureDateFrom: today,
            departureDateTo: today,
            limit: 100,
          },
        })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: property } = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.get(`/v1/properties/${propertyId}`).then((r) => r.data),
    enabled: !!propertyId && !!checkInModal,
  });

  const needReadyRooms = !!checkInModal || !!moveModal || walkInOpen;
  const { data: availableRooms } = useQuery({
    queryKey: ['rooms', 'available', propertyId],
    queryFn: () =>
      api.get('/v1/rooms/by-status', { params: { propertyId, status: 'guest_ready' } }).then((r) => r.data),
    enabled: !!propertyId && needReadyRooms,
  });

  const { data: roomTypes } = useQuery({
    queryKey: ['room-types', propertyId],
    queryFn: () => api.get('/v1/room-types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && walkInOpen,
  });

  const { data: ratePlans } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && walkInOpen,
  });

  const { data: notesData, refetch: refetchNotes } = useQuery({
    queryKey: ['reservation-notes', notesModal?.id, propertyId],
    queryFn: () =>
      api
        .get(`/v1/reservations/${notesModal!.id}/notes`, { params: { propertyId } })
        .then((r) => r.data),
    enabled: !!propertyId && !!notesModal,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['reservations'] });
    queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };

  const registrationRequired = property?.guestRegistrationRequired !== false;

  const checkInMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      status: string;
      preAssignedRoomId?: string;
      roomId?: string;
      idType?: string;
      idNumber?: string;
      registrationSigned?: boolean;
      registrationData?: Record<string, string>;
    }) => {
      if (data.status === 'confirmed') {
        const roomToAssign = data.roomId || data.preAssignedRoomId;
        if (!roomToAssign) {
          throw new Error(t('frontDesk.assignRoomBeforeCheckIn'));
        }
        await api.patch(`/v1/reservations/${data.id}/assign-room`, { roomId: roomToAssign }, {
          params: { propertyId },
        });
      }
      return api.patch(
        `/v1/reservations/${data.id}/check-in`,
        {
          roomId: data.roomId || undefined,
          idType: data.idType,
          idNumber: data.idNumber,
          registrationSigned: data.registrationSigned,
          registrationData: data.registrationData,
        },
        { params: { propertyId } },
      );
    },
    onSuccess: () => {
      invalidateAll();
      setCheckInModal(null);
      resetCheckInForm();
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/v1/reservations/${id}/check-out`, {}, { params: { propertyId } }),
    onSuccess: () => {
      invalidateAll();
      setCheckOutModal(null);
    },
  });

  const expressCheckoutMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/v1/reservations/${id}/express-checkout`, {}, { params: { propertyId } }),
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

  const moveMutation = useMutation({
    mutationFn: () =>
      api.patch(
        `/v1/reservations/${moveModal!.id}/move-room`,
        {
          roomId: moveRoomId,
          overrideDoNotMove: overrideDoNotMove || undefined,
          reason: moveReason || undefined,
        },
        { params: { propertyId } },
      ),
    onSuccess: () => {
      invalidateAll();
      setMoveModal(null);
      setMoveRoomId('');
      setOverrideDoNotMove(false);
      setMoveReason('');
    },
  });

  const walkInMutation = useMutation({
    mutationFn: async () => {
      requirePropertyId(propertyId);
      setWiError('');
      if (!wiFirst.trim() || !wiLast.trim() || !wiRoomTypeId || !wiRatePlanId || !wiRoomId) {
        throw new Error(t('frontDesk.walkInRequired'));
      }
      const plans: any[] = Array.isArray(ratePlans) ? ratePlans : ratePlans?.data ?? [];
      const plan = plans.find((p) => p.id === wiRatePlanId);
      const guestRes = await api.post('/v1/guests', {
        firstName: wiFirst.trim(),
        lastName: wiLast.trim(),
        email: wiEmail.trim() || undefined,
      });
      const guestId = guestRes.data.id;
      const resCreate = await api.post('/v1/reservations', {
        propertyId,
        guestId,
        roomTypeId: wiRoomTypeId,
        ratePlanId: wiRatePlanId,
        arrivalDate: today,
        departureDate: tomorrow,
        adults: 1,
        source: 'walk_in',
        totalAmount: plan?.baseAmount ?? '0.00',
        currencyCode: plan?.currencyCode ?? 'USD',
      });
      const reservationId = resCreate.data.id ?? resCreate.data.reservation?.id;
      await api.patch(
        `/v1/reservations/${reservationId}/confirm`,
        {},
        { params: { propertyId } },
      );
      await api.patch(
        `/v1/reservations/${reservationId}/assign-room`,
        { roomId: wiRoomId },
        { params: { propertyId } },
      );
      return reservationId as string;
    },
    onSuccess: (reservationId) => {
      const stub: Reservation = {
        id: reservationId,
        confirmationNumber: '—',
        status: 'assigned',
        arrivalDate: today,
        departureDate: tomorrow,
        roomId: wiRoomId,
        guestName: `${wiFirst} ${wiLast}`.trim(),
      };
      invalidateAll();
      setWalkInOpen(false);
      resetWalkIn();
      setCheckInModal(stub);
      resetCheckInForm();
    },
    onError: (err: any) => {
      setWiError(err?.response?.data?.message ?? err?.message ?? t('frontDesk.walkInFailed'));
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: () =>
      api.post(`/v1/reservations/${notesModal!.id}/notes`, {
        propertyId,
        body: noteBody.trim(),
      }),
    onSuccess: () => {
      setNoteBody('');
      refetchNotes();
    },
  });

  function resetCheckInForm() {
    setIdType('passport');
    setIdNumber('');
    setSelectedRoom('');
    setRegistrationSigned(false);
    setRegAddress('');
    setRegNationality('');
  }

  function resetWalkIn() {
    setWiFirst('');
    setWiLast('');
    setWiEmail('');
    setWiRoomTypeId('');
    setWiRatePlanId('');
    setWiRoomId('');
    setWiError('');
  }

  const guestName = (r: Reservation) =>
    r.guestName ??
    (r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : t('frontDesk.unknownGuest'));

  const arrList: Reservation[] = arrivals?.data ?? arrivals ?? [];
  const ihList: Reservation[] = inHouse?.data ?? inHouse ?? [];
  const depList: Reservation[] = departureData?.data ?? departureData ?? [];
  const roomList: Room[] = useMemo(() => {
    const raw = availableRooms?.data ?? availableRooms ?? [];
    return Array.isArray(raw) ? raw : [];
  }, [availableRooms]);
  const unassignedCount = Array.isArray(unassigned)
    ? unassigned.length
    : (unassigned?.data?.length ?? unassigned?.total ?? 0);
  const noteList: NoteRow[] = notesData?.notes ?? notesData?.data ?? (Array.isArray(notesData) ? notesData : []);
  const activeNoteCount = notesData?.activeCount ?? noteList.filter((n) => n.isActive).length;

  const rtList: any[] = Array.isArray(roomTypes) ? roomTypes : roomTypes?.data ?? [];
  const rpList: any[] = Array.isArray(ratePlans) ? ratePlans : ratePlans?.data ?? [];
  const filteredPlans = wiRoomTypeId
    ? rpList.filter((p) => p.roomTypeId === wiRoomTypeId && p.isActive !== false)
    : rpList;
  const walkInRooms = wiRoomTypeId
    ? roomList.filter((r) => !r.roomTypeId || r.roomTypeId === wiRoomTypeId)
    : roomList;

  const tabs: { key: Tab; label: string; icon: typeof LogIn; count: number }[] = [
    {
      key: 'arrivals',
      label: t('frontDesk.arrivals'),
      icon: LogIn,
      count: arrList.length,
    },
    { key: 'in-house', label: t('frontDesk.inHouse'), icon: Users, count: ihList.length },
    { key: 'departures', label: t('frontDesk.departures'), icon: LogOut, count: depList.length },
  ];

  if (!propertyId) {
    return <p className="text-sm text-telivity-mid-grey">{t('frontDesk.selectProperty')}</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <ConciergeBell size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('frontDesk.title')}</h1>
        {unassignedCount > 0 && (
          <span className="rounded-full bg-telivity-orange/15 text-telivity-orange text-xs font-semibold px-2.5 py-1">
            {t('frontDesk.unassignedBadge', { count: unassignedCount })}
          </span>
        )}
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
          <button
            onClick={() => {
              resetWalkIn();
              setWalkInOpen(true);
            }}
            className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors"
          >
            <UserPlus size={16} />
            {t('frontDesk.walkIn')}
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-4">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              tab === tb.key
                ? 'bg-telivity-teal text-white'
                : 'text-telivity-slate hover:bg-telivity-light-grey'
            }`}
          >
            <tb.icon size={16} />
            {tb.label}
            <span
              className={`px-1.5 py-0.5 rounded-full text-xs ${
                tab === tb.key ? 'bg-white/20' : 'bg-telivity-light-grey'
              }`}
            >
              {tb.count}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              {tab === 'arrivals' && (
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedForGroup.length === arrList.length && arrList.length > 0}
                    onChange={(e) =>
                      setSelectedForGroup(e.target.checked ? arrList.map((r) => r.id) : [])
                    }
                    className="rounded border-gray-300"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                {t('frontDesk.guest')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                {t('frontDesk.confirmation')}
              </th>
              {tab === 'arrivals' && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                  {t('frontDesk.roomType')}
                </th>
              )}
              {(tab === 'arrivals' || tab === 'in-house' || tab === 'departures') && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                  {t('frontDesk.room')}
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                {tab === 'departures' ? t('frontDesk.departure') : t('frontDesk.arrival')}
              </th>
              {tab === 'in-house' && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                  {t('frontDesk.departure')}
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                {t('common.status')}
              </th>
              {(tab === 'in-house' || tab === 'departures') && (
                <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                  {t('frontDesk.balance')}
                </th>
              )}
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                {t('common.actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {(tab === 'arrivals' ? arrList : tab === 'in-house' ? ihList : depList).map((r, i) => (
              <tr
                key={r.id}
                className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors`}
              >
                {tab === 'arrivals' && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedForGroup.includes(r.id)}
                      onChange={(e) =>
                        setSelectedForGroup(
                          e.target.checked
                            ? [...selectedForGroup, r.id]
                            : selectedForGroup.filter((id) => id !== r.id),
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
                <td className="px-4 py-3 text-sm text-telivity-slate">
                  {r.roomNumber ?? (
                    <span className="text-telivity-orange font-medium">{t('frontDesk.notAssigned')}</span>
                  )}
                  {r.doNotMove && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-telivity-mid-grey">
                      {t('frontDesk.dnm')}
                    </span>
                  )}
                </td>
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
                  <div className="flex gap-2 justify-end flex-wrap">
                    <button
                      onClick={() => {
                        setNotesModal(r);
                        setNoteBody('');
                      }}
                      className="text-telivity-slate hover:text-telivity-teal p-1"
                      title={t('frontDesk.notes')}
                    >
                      <StickyNote size={16} />
                    </button>
                    {tab === 'arrivals' && (
                      <button
                        onClick={() => {
                          setCheckInModal(r);
                          resetCheckInForm();
                        }}
                        className="bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-teal transition-colors"
                      >
                        {t('frontDesk.checkIn')}
                      </button>
                    )}
                    {tab === 'in-house' && (
                      <>
                        <button
                          onClick={() => {
                            setMoveModal(r);
                            setMoveRoomId('');
                            setOverrideDoNotMove(false);
                            setMoveReason('');
                          }}
                          className="border border-gray-200 text-telivity-slate rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey inline-flex items-center gap-1"
                        >
                          <ArrowRightLeft size={12} />
                          {t('frontDesk.moveRoom')}
                        </button>
                        <a
                          href={`/folios?reservationId=${r.id}`}
                          className="text-telivity-teal text-xs font-semibold hover:underline self-center"
                        >
                          {t('frontDesk.viewFolio')}
                        </a>
                      </>
                    )}
                    {tab === 'departures' && (
                      <>
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
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(tab === 'arrivals' ? arrList : tab === 'in-house' ? ihList : depList).length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">
                  {t('frontDesk.noToday', {
                    item:
                      tab === 'arrivals'
                        ? t('frontDesk.arrivals').toLowerCase()
                        : tab === 'in-house'
                          ? t('frontDesk.inHouse').toLowerCase()
                          : t('frontDesk.departures').toLowerCase(),
                  })}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Check-In Modal */}
      <Modal
        open={!!checkInModal}
        onClose={() => setCheckInModal(null)}
        title={t('frontDesk.checkInGuest')}
        wide
      >
        {checkInModal && (
          <div className="space-y-4">
            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-sm font-semibold text-telivity-navy">{guestName(checkInModal)}</p>
              <p className="text-xs text-telivity-mid-grey mt-1">
                {checkInModal.confirmationNumber} &middot; {checkInModal.arrivalDate} →{' '}
                {checkInModal.departureDate}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">
                {t('frontDesk.idDocumentType')}
              </label>
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
              <label className="block text-sm font-medium text-telivity-navy mb-1">
                {t('frontDesk.idNumber')}
              </label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                placeholder={t('frontDesk.enterIdNumber')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-telivity-navy mb-1">
                  {t('frontDesk.regNationality')}
                </label>
                <input
                  type="text"
                  value={regNationality}
                  onChange={(e) => setRegNationality(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-telivity-navy mb-1">
                  {t('frontDesk.regAddress')}
                </label>
                <input
                  type="text"
                  value={regAddress}
                  onChange={(e) => setRegAddress(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-telivity-navy">
              <input
                type="checkbox"
                checked={registrationSigned}
                onChange={(e) => setRegistrationSigned(e.target.checked)}
                className="rounded border-gray-300"
              />
              {t('frontDesk.registrationSigned')}
              {registrationRequired && (
                <span className="text-telivity-orange text-xs">({t('common.required')})</span>
              )}
            </label>

            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">
                {t('frontDesk.assignRoom')}
              </label>
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="">{t('frontDesk.usePreAssignedRoom')}</option>
                {roomList.map((room) => (
                  <option key={room.id} value={room.id}>
                    {t('frontDesk.roomNumber', {
                      number: room.roomNumber ?? room.number ?? room.id.slice(0, 8),
                    })}{' '}
                    {room.roomTypeName ? `(${room.roomTypeName})` : ''} —{' '}
                    {formatLabel(room.status, t)}
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
                onClick={() =>
                  checkInMutation.mutate({
                    id: checkInModal.id,
                    status: checkInModal.status,
                    preAssignedRoomId: checkInModal.roomId,
                    roomId: selectedRoom || undefined,
                    idType,
                    idNumber: idNumber || undefined,
                    registrationSigned,
                    registrationData: {
                      nationality: regNationality,
                      address: regAddress,
                    },
                  })
                }
                disabled={
                  checkInMutation.isPending || (registrationRequired && !registrationSigned)
                }
                className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors disabled:opacity-50"
              >
                {checkInMutation.isPending
                  ? t('frontDesk.checkingIn')
                  : t('frontDesk.confirmCheckIn')}
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

      {/* Move Room Modal */}
      <Modal
        open={!!moveModal}
        onClose={() => setMoveModal(null)}
        title={t('frontDesk.moveRoomTitle')}
      >
        {moveModal && (
          <div className="space-y-4">
            <p className="text-sm text-telivity-slate">
              {guestName(moveModal)} — {t('frontDesk.roomNumber', { number: moveModal.roomNumber ?? '—' })}
            </p>
            {moveModal.doNotMove && (
              <p className="text-xs text-telivity-orange">{t('frontDesk.doNotMoveWarning')}</p>
            )}
            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">
                {t('frontDesk.newRoom')}
              </label>
              <select
                value={moveRoomId}
                onChange={(e) => setMoveRoomId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              >
                <option value="">{t('frontDesk.selectRoom')}</option>
                {roomList.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.roomNumber ?? room.number} — {formatLabel(room.status, t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-telivity-navy mb-1">
                {t('frontDesk.moveReason')}
              </label>
              <input
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
              />
            </div>
            {moveModal.doNotMove && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={overrideDoNotMove}
                  onChange={(e) => setOverrideDoNotMove(e.target.checked)}
                />
                {t('frontDesk.overrideDoNotMove')}
              </label>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setMoveModal(null)}
                className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => moveMutation.mutate()}
                disabled={!moveRoomId || moveMutation.isPending}
                className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {moveMutation.isPending ? t('common.processing') : t('frontDesk.confirmMove')}
              </button>
            </div>
            {moveMutation.isError && (
              <p className="text-sm text-telivity-orange">
                {(moveMutation.error as any)?.response?.data?.message ??
                  (moveMutation.error as Error).message}
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Walk-In Modal */}
      <Modal
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        title={t('frontDesk.walkInTitle')}
        wide
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('frontDesk.firstName')}
              </label>
              <input
                value={wiFirst}
                onChange={(e) => setWiFirst(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('frontDesk.lastName')}
              </label>
              <input
                value={wiLast}
                onChange={(e) => setWiLast(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('frontDesk.emailOptional')}
            </label>
            <input
              value={wiEmail}
              onChange={(e) => setWiEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('frontDesk.roomType')}
            </label>
            <select
              value={wiRoomTypeId}
              onChange={(e) => {
                setWiRoomTypeId(e.target.value);
                setWiRatePlanId('');
                setWiRoomId('');
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
              value={wiRatePlanId}
              onChange={(e) => setWiRatePlanId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('frontDesk.selectRatePlan')}</option>
              {filteredPlans.map((rp) => (
                <option key={rp.id} value={rp.id}>
                  {rp.name} — {moneyString(rp.baseAmount)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
              {t('frontDesk.assignRoom')}
            </label>
            <select
              value={wiRoomId}
              onChange={(e) => setWiRoomId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('frontDesk.selectRoom')}</option>
              {walkInRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.roomNumber ?? room.number} — {formatLabel(room.status, t)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-telivity-mid-grey">
            {t('frontDesk.walkInStay', { checkIn: today, checkOut: tomorrow })}
          </p>
          {wiError && <p className="text-sm text-telivity-orange">{wiError}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => setWalkInOpen(false)}
              className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => walkInMutation.mutate()}
              disabled={walkInMutation.isPending}
              className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {walkInMutation.isPending
                ? t('common.processing')
                : t('frontDesk.createWalkIn')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Notes Modal */}
      <Modal
        open={!!notesModal}
        onClose={() => setNotesModal(null)}
        title={t('frontDesk.notesTitle', { name: notesModal ? guestName(notesModal) : '' })}
      >
        {notesModal && (
          <div className="space-y-4">
            <p className="text-xs text-telivity-mid-grey">
              {t('frontDesk.activeNotes', { count: activeNoteCount })}
            </p>
            <ul className="space-y-2 max-h-48 overflow-y-auto">
              {noteList.map((n) => (
                <li
                  key={n.id}
                  className={`text-sm rounded-lg p-3 ${n.isActive ? 'bg-telivity-light-grey' : 'bg-gray-50 text-telivity-mid-grey line-through'}`}
                >
                  {n.body}
                </li>
              ))}
              {noteList.length === 0 && (
                <li className="text-sm text-telivity-mid-grey">{t('frontDesk.noNotes')}</li>
              )}
            </ul>
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={3}
              placeholder={t('frontDesk.addNotePlaceholder')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => addNoteMutation.mutate()}
              disabled={!noteBody.trim() || addNoteMutation.isPending}
              className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {t('frontDesk.addNote')}
            </button>
          </div>
        )}
      </Modal>

      {/* Check-Out Modal */}
      <Modal
        open={!!checkOutModal}
        onClose={() => setCheckOutModal(null)}
        title={t('frontDesk.checkOutGuest')}
      >
        {checkOutModal && (
          <div className="space-y-4">
            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-sm font-semibold text-telivity-navy">{guestName(checkOutModal)}</p>
              <p className="text-xs text-telivity-mid-grey mt-1">
                {t('frontDesk.roomNumber', { number: checkOutModal.roomNumber ?? '—' })} &middot;{' '}
                {checkOutModal.confirmationNumber}
              </p>
            </div>
            <div className="bg-telivity-light-grey rounded-lg p-4">
              <p className="text-xs text-telivity-mid-grey">{t('frontDesk.outstandingBalance')}</p>
              <p className="text-xl font-semibold text-telivity-navy">
                ${Number(checkOutModal.balance ?? 0).toFixed(2)}
              </p>
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
                {checkOutMutation.isPending
                  ? t('common.processing')
                  : t('frontDesk.confirmCheckOut')}
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
  return t(`dashboard.roomStatuses.${s}`, {
    defaultValue: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  });
}
