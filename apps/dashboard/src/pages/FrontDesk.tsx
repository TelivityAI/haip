import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ConciergeBell, LogIn, Users, LogOut, UserPlus, UsersRound, ArrowRightLeft, StickyNote, UserRound } from 'lucide-react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import FindGuest from '../components/guests/FindGuest';
import IdSwipeCapture from '../components/guests/IdSwipeCapture';
import GuestDetailsModal from '../components/front-desk/GuestDetailsModal';
import type { ParsedIdDocument } from '../lib/id-document-swipe';
import type { Guest } from '../types/guest';

type Tab = 'arrivals' | 'in-house' | 'departures';

interface Reservation {
  id: string;
  confirmationNumber: string;
  bookingId?: string;
  guestId?: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  roomId?: string;
  roomNumber?: string;
  roomTypeId?: string;
  roomTypeName?: string;
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
  balance?: number;
  doNotMove?: boolean;
  totalAmount?: string;
  ratePlanId?: string;
}

interface PartyGroup {
  key: string;
  confirmationNumber: string;
  members: Reservation[];
}

function groupByBooking(list: Reservation[]): PartyGroup[] {
  const order: string[] = [];
  const map = new Map<string, Reservation[]>();
  for (const r of list) {
    const key = r.bookingId || r.confirmationNumber || r.id;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(r);
  }
  return order.map((key) => {
    const members = map.get(key)!;
    return {
      key,
      confirmationNumber: members[0]?.confirmationNumber || '—',
      members,
    };
  });
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

interface DoorLockCredential {
  reservationId: string;
  accessCode?: string | null;
  status: 'active' | 'revoked';
}

/** Desk party size limit for walk-in create and party check-in. */
const MAX_FRONT_DESK_PARTY_ROOMS = 4;

/** Additional walk-in rooms beyond the primary (same booking / party). */
interface WalkInExtraRoom {
  key: string;
  guest: Guest | null;
  roomTypeId: string;
  ratePlanId: string;
  roomId: string;
}

function emptyWalkInExtraRoom(defaults?: {
  roomTypeId?: string;
  ratePlanId?: string;
}): WalkInExtraRoom {
  return {
    key: crypto.randomUUID(),
    guest: null,
    roomTypeId: defaults?.roomTypeId ?? '',
    ratePlanId: defaults?.ratePlanId ?? '',
    roomId: '',
  };
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
  const [detailsModal, setDetailsModal] = useState<Reservation | null>(null);
  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);

  // Check-in form
  const [idType, setIdType] = useState('passport');
  const [idNumber, setIdNumber] = useState('');
  const [idCountry, setIdCountry] = useState('');
  const [idExpiry, setIdExpiry] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [registrationSigned, setRegistrationSigned] = useState(false);
  const [regAddress, setRegAddress] = useState('');
  const [regNationality, setRegNationality] = useState('');
  const [travelReason, setTravelReason] = useState('leisure');
  const [transportationMode, setTransportationMode] = useState('plane');
  const [originCity, setOriginCity] = useState('');
  const [originState, setOriginState] = useState('');
  const [originCountry, setOriginCountry] = useState('');
  const [destinationCity, setDestinationCity] = useState('');
  const [destinationState, setDestinationState] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [showFnrhTravel, setShowFnrhTravel] = useState(false);
  const [checkInIncludeIds, setCheckInIncludeIds] = useState<string[]>([]);
  const [checkInPartyRooms, setCheckInPartyRooms] = useState<Record<string, string>>({});

  // Move form
  const [moveRoomId, setMoveRoomId] = useState('');
  const [overrideDoNotMove, setOverrideDoNotMove] = useState(false);
  const [moveReason, setMoveReason] = useState('');

  // Walk-in form — primary room + N additional rooms (same booking / party)
  const [wiGuest, setWiGuest] = useState<Guest | null>(null);
  const [wiArrivalDate, setWiArrivalDate] = useState(today);
  const [wiDepartureDate, setWiDepartureDate] = useState(tomorrow);
  const [wiRoomTypeId, setWiRoomTypeId] = useState('');
  const [wiRatePlanId, setWiRatePlanId] = useState('');
  const [wiRoomId, setWiRoomId] = useState('');
  const [wiExtraRooms, setWiExtraRooms] = useState<WalkInExtraRoom[]>([]);
  const [wiError, setWiError] = useState('');

  const wiNights = useMemo(() => {
    try {
      const n = differenceInCalendarDays(parseISO(wiDepartureDate), parseISO(wiArrivalDate));
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }, [wiArrivalDate, wiDepartureDate]);

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
        // ListUnassignedDto uses from/to (not the list endpoint's arrivalDateFrom/To);
        // the API rejects unknown query params.
        .get('/v1/reservations/unassigned', {
          params: { propertyId, from: today, to: today },
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

  const { data: doorCredentials } = useQuery({
    queryKey: ['door-lock', 'credentials', propertyId, 'active'],
    queryFn: () =>
      api
        .get('/v1/door-lock/credentials', {
          params: { propertyId, status: 'active', limit: 200 },
        })
        .then((r) => r.data),
    enabled: !!propertyId && (tab === 'in-house' || !!detailsModal),
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
    queryFn: () => api.get('/v1/rooms/types', { params: { propertyId } }).then((r) => r.data),
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
      idCountry?: string;
      idExpiry?: string;
      registrationSigned?: boolean;
      registrationData?: Record<string, string>;
      party?: Array<{ reservationId: string; roomId?: string }>;
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
      await api.patch(
        `/v1/reservations/${data.id}/check-in`,
        {
          roomId: data.roomId || undefined,
          idType: data.idType,
          idNumber: data.idNumber,
          idCountry: data.idCountry || undefined,
          idExpiry: data.idExpiry || undefined,
          registrationSigned: data.registrationSigned,
          registrationData: data.registrationData,
        },
        { params: { propertyId } },
      );
      const party = (data.party ?? []).slice(0, MAX_FRONT_DESK_PARTY_ROOMS - 1);
      if (party.length > 0) {
        requirePropertyId(propertyId);
        await api.post(
          '/v1/reservations/group-check-in',
          {
            reservations: party.map((p) => ({
              reservationId: p.reservationId,
              roomId: p.roomId,
            })),
          },
          { params: { propertyId } },
        );
      }
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
      const capped = reservationIds.slice(0, MAX_FRONT_DESK_PARTY_ROOMS);
      return api.post(
        '/v1/reservations/group-check-in',
        { reservations: capped.map((reservationId) => ({ reservationId })) },
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
      if (!wiGuest?.id || !wiRoomTypeId || !wiRatePlanId || !wiRoomId || wiNights <= 0) {
        throw new Error(t('frontDesk.walkInRequired'));
      }
      if (1 + wiExtraRooms.length > MAX_FRONT_DESK_PARTY_ROOMS) {
        throw new Error(t('frontDesk.partyRoomLimit', { count: MAX_FRONT_DESK_PARTY_ROOMS }));
      }
      for (let i = 0; i < wiExtraRooms.length; i++) {
        const extra = wiExtraRooms[i];
        if (!extra.guest?.id || !extra.roomTypeId || !extra.ratePlanId || !extra.roomId) {
          throw new Error(t('frontDesk.walkInExtraRequired', { room: i + 2 }));
        }
      }
      const allRoomIds = [wiRoomId, ...wiExtraRooms.map((r) => r.roomId)];
      if (new Set(allRoomIds).size !== allRoomIds.length) {
        throw new Error(t('frontDesk.walkInDistinctRooms'));
      }
      const plans: any[] = Array.isArray(ratePlans) ? ratePlans : ratePlans?.data ?? [];
      const plan = plans.find((p) => p.id === wiRatePlanId);
      const nightly = Number(plan?.baseAmount ?? 0);
      const guestId = wiGuest.id;
      const resCreate = await api.post(
        '/v1/reservations',
        {
          propertyId,
          guestId,
          roomTypeId: wiRoomTypeId,
          ratePlanId: wiRatePlanId,
          arrivalDate: wiArrivalDate,
          departureDate: wiDepartureDate,
          adults: 1,
          source: 'walk_in',
          totalAmount: moneyString(nightly * wiNights),
          currencyCode: plan?.currencyCode ?? 'USD',
        },
        { skipErrorToast: true },
      );
      const reservationId = resCreate.data.id ?? resCreate.data.reservation?.id;
      const confirmationNumber =
        resCreate.data.booking?.confirmationNumber ??
        resCreate.data.confirmationNumber ??
        '—';
      const bookingId = resCreate.data.bookingId ?? resCreate.data.booking?.id;
      await api.patch(
        `/v1/reservations/${reservationId}/confirm`,
        {},
        { params: { propertyId }, skipErrorToast: true },
      );
      await api.patch(
        `/v1/reservations/${reservationId}/assign-room`,
        { roomId: wiRoomId },
        { params: { propertyId }, skipErrorToast: true },
      );

      for (const extra of wiExtraRooms) {
        const planExtra = plans.find((p) => p.id === extra.ratePlanId);
        const nightlyExtra = Number(planExtra?.baseAmount ?? 0);
        await api.post(
          `/v1/reservations/${reservationId}/guests`,
          { guestId: extra.guest!.id },
          { params: { propertyId }, skipErrorToast: true },
        );
        await api.post(
          `/v1/reservations/${reservationId}/split`,
          {
            guestIds: [extra.guest!.id],
            roomTypeId: extra.roomTypeId,
            ratePlanId: extra.ratePlanId,
            totalAmount: moneyString(nightlyExtra * wiNights),
            currencyCode: planExtra?.currencyCode ?? 'USD',
            roomId: extra.roomId,
            adults: 1,
          },
          { params: { propertyId }, skipErrorToast: true },
        );
      }

      return {
        reservationId: reservationId as string,
        confirmationNumber: confirmationNumber as string,
        bookingId: bookingId as string | undefined,
        partySize: 1 + wiExtraRooms.length,
      };
    },
    onSuccess: ({ reservationId, confirmationNumber, bookingId, partySize }) => {
      const guestSnapshot = wiGuest;
      const stub: Reservation = {
        id: reservationId,
        confirmationNumber,
        bookingId,
        guestId: guestSnapshot?.id,
        status: 'assigned',
        arrivalDate: wiArrivalDate,
        departureDate: wiDepartureDate,
        roomId: wiRoomId,
        guestName: guestSnapshot
          ? `${guestSnapshot.firstName} ${guestSnapshot.lastName}`.trim()
          : '—',
      };
      invalidateAll();
      setWalkInOpen(false);
      resetWalkIn();
      if (partySize > 1) {
        setDetailsModal(stub);
      } else {
        void openCheckIn(stub, undefined, guestSnapshot);
      }
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
    setIdCountry('');
    setIdExpiry('');
    setSelectedRoom('');
    setRegistrationSigned(false);
    setRegAddress('');
    setRegNationality('');
    setTravelReason('leisure');
    setTransportationMode('plane');
    setOriginCity('');
    setOriginState('');
    setOriginCountry('');
    setDestinationCity('');
    setDestinationState('');
    setDestinationCountry('');
    setShowFnrhTravel(false);
    setCheckInIncludeIds([]);
    setCheckInPartyRooms({});
  }

  function partyKey(r: Reservation) {
    return r.bookingId || r.confirmationNumber || r.id;
  }

  function applyGuestToCheckIn(guest: Guest) {
    if (guest.idType) setIdType(guest.idType);
    if (guest.idNumber) setIdNumber(guest.idNumber);
    if (guest.idCountry) setIdCountry(guest.idCountry);
    if (guest.idExpiry) setIdExpiry(guest.idExpiry);
    if (guest.nationality) setRegNationality(guest.nationality);
    const address = [
      guest.addressLine1,
      guest.addressLine2,
      guest.city,
      guest.stateProvince,
      guest.postalCode,
      guest.countryCode,
    ]
      .filter(Boolean)
      .join(', ');
    if (address) setRegAddress(address);
  }

  function applyIdDocToCheckIn(doc: ParsedIdDocument) {
    if (doc.idType) setIdType(doc.idType);
    if (doc.idNumber) setIdNumber(doc.idNumber);
    if (doc.idCountry) setIdCountry(doc.idCountry);
    if (doc.idExpiry) setIdExpiry(doc.idExpiry);
    if (doc.nationality) setRegNationality(doc.nationality);
    const address = [doc.addressLine1, doc.city, doc.stateProvince, doc.postalCode]
      .filter(Boolean)
      .join(', ');
    if (address) setRegAddress(address);
  }

  async function openCheckIn(
    primary: Reservation,
    partyMembers?: Reservation[],
    guestHint?: Guest | null,
  ) {
    const pool = partyMembers ?? arrList.filter((r) => partyKey(r) === partyKey(primary));
    const ordered = [primary, ...pool.filter((r) => r.id !== primary.id)].slice(
      0,
      MAX_FRONT_DESK_PARTY_ROOMS,
    );
    resetCheckInForm();
    setCheckInModal(primary);
    setCheckInIncludeIds(ordered.filter((r) => r.id !== primary.id).map((r) => r.id));
    setCheckInPartyRooms(Object.fromEntries(ordered.map((r) => [r.id, r.roomId ?? ''])));
    setSelectedRoom(primary.roomId ?? '');

    if (guestHint) {
      applyGuestToCheckIn(guestHint);
      return;
    }
    if (!primary.guestId) return;
    try {
      const res = await api.get(`/v1/guests/${primary.guestId}`);
      const guest = (res.data?.data ?? res.data) as Guest | undefined;
      if (guest) applyGuestToCheckIn(guest);
    } catch {
      /* guest profile optional for check-in open */
    }
  }

  function resetWalkIn() {
    setWiGuest(null);
    setWiArrivalDate(today);
    setWiDepartureDate(tomorrow);
    setWiRoomTypeId('');
    setWiRatePlanId('');
    setWiRoomId('');
    setWiExtraRooms([]);
    setWiError('');
  }

  function updateExtraRoom(key: string, patch: Partial<WalkInExtraRoom>) {
    setWiExtraRooms((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeExtraRoom(key: string) {
    setWiExtraRooms((prev) => prev.filter((r) => r.key !== key));
  }

  const guestName = (r: Reservation) =>
    r.guestName ??
    (r.guest ? `${r.guest.firstName} ${r.guest.lastName}` : t('frontDesk.unknownGuest'));

  const guestRecognition = (r: Reservation) => {
    const vipLevel = r.guest?.vipLevel;
    const loyaltyNumber = r.guest?.loyaltyNumber;
    if ((!vipLevel || vipLevel === 'none') && !loyaltyNumber) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
        {vipLevel && vipLevel !== 'none' && <StatusBadge status={vipLevel} />}
        {loyaltyNumber && (
          <span className="text-[11px] text-telivity-mid-grey">{t('frontDesk.loyaltyNumber', { number: loyaltyNumber })}</span>
        )}
      </div>
    );
  };

  const arrList: Reservation[] = arrivals?.data ?? arrivals ?? [];
  const ihList: Reservation[] = inHouse?.data ?? inHouse ?? [];
  const depList: Reservation[] = departureData?.data ?? departureData ?? [];
  const doorPinByReservation = useMemo(() => {
    const rows: DoorLockCredential[] = doorCredentials?.data ?? [];
    return new Map(rows.map((c) => [c.reservationId, c]));
  }, [doorCredentials]);
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
  const takenRoomIds = (exceptKey?: string) => {
    const ids = new Set<string>();
    if (wiRoomId) ids.add(wiRoomId);
    for (const extra of wiExtraRooms) {
      if (exceptKey && extra.key === exceptKey) continue;
      if (extra.roomId) ids.add(extra.roomId);
    }
    return ids;
  };
  const roomsForExtra = (extra: WalkInExtraRoom) => {
    const taken = takenRoomIds(extra.key);
    return roomList.filter(
      (r) =>
        !taken.has(r.id) &&
        (!extra.roomTypeId || !r.roomTypeId || r.roomTypeId === extra.roomTypeId),
    );
  };
  const plansForRoomType = (roomTypeId: string) =>
    roomTypeId
      ? rpList.filter((p) => p.roomTypeId === roomTypeId && p.isActive !== false)
      : rpList;

  const currentList = tab === 'arrivals' ? arrList : tab === 'in-house' ? ihList : depList;
  const partyGroups = useMemo(() => groupByBooking(currentList), [currentList]);

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
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === tb.key
                ? 'bg-telivity-teal text-white'
                : 'text-telivity-slate hover:bg-telivity-light-grey'
              }`}
          >
            <tb.icon size={16} />
            {tb.label}
            <span
              className={`px-1.5 py-0.5 rounded-full text-xs ${tab === tb.key ? 'bg-white/20' : 'bg-telivity-light-grey'
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
                    checked={
                      selectedForGroup.length > 0 &&
                      selectedForGroup.length ===
                        Math.min(arrList.length, MAX_FRONT_DESK_PARTY_ROOMS)
                    }
                    onChange={(e) =>
                      setSelectedForGroup(
                        e.target.checked
                          ? arrList.slice(0, MAX_FRONT_DESK_PARTY_ROOMS).map((r) => r.id)
                          : [],
                      )
                    }
                    className="rounded border-gray-300"
                    title={t('frontDesk.partyRoomLimit', { count: MAX_FRONT_DESK_PARTY_ROOMS })}
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
              {tab === 'in-house' && (
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">
                  {t('frontDesk.doorPin')}
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
            {partyGroups.map((group) => {
              const showPartyHeader = group.members.length > 1;
              return (
                <Fragment key={group.key}>
                  {showPartyHeader && (
                    <tr className="bg-telivity-teal/5 border-b border-telivity-teal/10">
                      <td
                        colSpan={10}
                        className="px-4 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wider text-telivity-teal">
                            {t('frontDesk.party')}
                          </span>
                          <span className="text-sm font-medium text-telivity-navy">
                            {group.confirmationNumber}
                          </span>
                          <span className="text-xs text-telivity-mid-grey">
                            {t('frontDesk.partyRooms', { count: group.members.length })}
                            {group.members.length > MAX_FRONT_DESK_PARTY_ROOMS
                              ? ` · ${t('frontDesk.partyRoomLimit', { count: MAX_FRONT_DESK_PARTY_ROOMS })}`
                              : ''}
                          </span>
                          {tab === 'arrivals' && (
                            <button
                              type="button"
                              onClick={() => openCheckIn(group.members[0], group.members)}
                              className="ml-auto inline-flex items-center gap-1.5 bg-telivity-deep-blue text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-deep-blue/90"
                            >
                              <UsersRound size={12} />
                              {t('frontDesk.partyCheckIn', {
                                count: Math.min(group.members.length, MAX_FRONT_DESK_PARTY_ROOMS),
                              })}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {group.members.map((r, i) => (
                    <tr
                      key={r.id}
                      className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors ${showPartyHeader ? 'border-l-2 border-l-telivity-teal/40' : ''}`}
                    >
                      {tab === 'arrivals' && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedForGroup.includes(r.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (selectedForGroup.length >= MAX_FRONT_DESK_PARTY_ROOMS) return;
                                setSelectedForGroup([...selectedForGroup, r.id]);
                              } else {
                                setSelectedForGroup(selectedForGroup.filter((id) => id !== r.id));
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm font-medium text-telivity-navy">
                        <div>{guestName(r)}</div>
                        {(tab === 'arrivals' || tab === 'in-house') && guestRecognition(r)}
                      </td>
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
                      {tab === 'in-house' && (
                        <td className="px-4 py-3 text-sm font-mono text-telivity-navy">
                          {doorPinByReservation.get(r.id)?.accessCode ?? (
                            <span className="text-telivity-mid-grey font-sans">{t('frontDesk.doorPinNone')}</span>
                          )}
                        </td>
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
                          {(tab === 'arrivals' || tab === 'in-house') && (
                            <button
                              onClick={() => setDetailsModal(r)}
                              className="border border-gray-200 text-telivity-slate rounded-lg px-2 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey inline-flex items-center gap-1"
                            >
                              <UserRound size={12} />
                              {t('frontDesk.guestDetails')}
                            </button>
                          )}
                          {tab === 'arrivals' && (
                            <button
                              onClick={() => openCheckIn(r)}
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
                                className="text-telivity-teal text-xs font-medium hover:underline self-center"
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
                </Fragment>
              );
            })}
            {currentList.length === 0 && (
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
        title=""
        wide
      >
        {checkInModal && (
          <div className="space-y-5">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 -mx-6 -mt-6 p-6 rounded-t-2xl text-white relative overflow-hidden border-b border-teal-500/20">
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-teal-500/20 border border-teal-500/30 rounded-xl text-teal-300">
                    <StickyNote size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-white">{t('frontDesk.checkInGuest')}</h2>
                    <p className="text-xs text-teal-200/80 mt-0.5">
                      <span className="font-semibold text-white">{guestName(checkInModal)}</span> &middot; {checkInModal.confirmationNumber} ({checkInModal.arrivalDate} → {checkInModal.departureDate})
                    </p>
                  </div>
                </div>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-semibold">
                  FNRH Ativa
                </span>
              </div>
            </div>

            <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-4 pt-1">
              <IdSwipeCapture active={!!checkInModal} onParsed={applyIdDocToCheckIn} />

              {/* Document Identity Section */}
              <div className="p-4 bg-gray-50/70 rounded-xl border border-gray-100 space-y-3">
                <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider flex items-center gap-1.5">
                  Identificação & Registro FNRH
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-telivity-navy mb-1">
                      {t('frontDesk.idDocumentType')}
                    </label>
                    <select
                      value={idType}
                      onChange={(e) => setIdType(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal focus:ring-2 focus:ring-telivity-teal/10 transition-all bg-white"
                    >
                      <option value="passport">{t('frontDesk.passport')}</option>
                      <option value="drivers_license">{t('frontDesk.driversLicense')}</option>
                      <option value="national_id">{t('frontDesk.nationalId')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-telivity-navy mb-1">
                      {t('frontDesk.idNumber')}
                    </label>
                    <input
                      type="text"
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal focus:ring-2 focus:ring-telivity-teal/10 transition-all bg-white"
                      placeholder={t('frontDesk.enterIdNumber')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-telivity-navy mb-1">
                      {t('frontDesk.idCountry')}
                    </label>
                    <input
                      type="text"
                      maxLength={2}
                      value={idCountry}
                      onChange={(e) => setIdCountry(e.target.value.toUpperCase())}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal focus:ring-2 focus:ring-telivity-teal/10 transition-all uppercase bg-white"
                      placeholder="BR / US"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-telivity-navy mb-1">
                      {t('frontDesk.idExpiry')}
                    </label>
                    <input
                      type="date"
                      value={idExpiry}
                      onChange={(e) => setIdExpiry(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal focus:ring-2 focus:ring-telivity-teal/10 transition-all bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-telivity-navy mb-1">
                      {t('frontDesk.regNationality')}
                    </label>
                    <input
                      type="text"
                      value={regNationality}
                      onChange={(e) => setRegNationality(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal focus:ring-2 focus:ring-telivity-teal/10 transition-all bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-telivity-navy mb-1">
                      {t('frontDesk.regAddress')}
                    </label>
                    <input
                      type="text"
                      value={regAddress}
                      onChange={(e) => setRegAddress(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal focus:ring-2 focus:ring-telivity-teal/10 transition-all bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* FNRH Stay Details Section */}
              <div className="border border-teal-100 rounded-xl p-4 bg-teal-50/20 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-telivity-teal uppercase tracking-wider flex items-center gap-1.5">
                    FNRH — Detalhes da Viagem & Procedência
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowFnrhTravel(!showFnrhTravel)}
                    className="text-xs text-telivity-teal font-semibold hover:underline"
                  >
                    {showFnrhTravel ? 'Recolher −' : 'Expandir +'}
                  </button>
                </div>

                {showFnrhTravel && (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-telivity-slate mb-1">{t('frontDesk.travelReason')}</label>
                        <select value={travelReason} onChange={(e) => setTravelReason(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal bg-white">
                          <option value="leisure">{t('frontDesk.travelReasons.leisure')}</option>
                          <option value="business">{t('frontDesk.travelReasons.business')}</option>
                          <option value="congress">{t('frontDesk.travelReasons.congress')}</option>
                          <option value="relatives">{t('frontDesk.travelReasons.relatives')}</option>
                          <option value="studies">{t('frontDesk.travelReasons.studies')}</option>
                          <option value="health">{t('frontDesk.travelReasons.health')}</option>
                          <option value="shopping">{t('frontDesk.travelReasons.shopping')}</option>
                          <option value="other">{t('frontDesk.travelReasons.other')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-telivity-slate mb-1">{t('frontDesk.transportationMode')}</label>
                        <select value={transportationMode} onChange={(e) => setTransportationMode(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal bg-white">
                          <option value="plane">{t('frontDesk.transportModes.plane')}</option>
                          <option value="car">{t('frontDesk.transportModes.car')}</option>
                          <option value="bus">{t('frontDesk.transportModes.bus')}</option>
                          <option value="motorcycle">{t('frontDesk.transportModes.motorcycle')}</option>
                          <option value="train">{t('frontDesk.transportModes.train')}</option>
                          <option value="ship">{t('frontDesk.transportModes.ship')}</option>
                          <option value="other">{t('frontDesk.transportModes.other')}</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-telivity-slate mb-1">{t('frontDesk.originCity')}</label>
                        <input type="text" value={originCity} onChange={(e) => setOriginCity(e.target.value)} className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-telivity-teal bg-white" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-telivity-slate mb-1">{t('frontDesk.originState')}</label>
                        <input type="text" maxLength={2} value={originState} onChange={(e) => setOriginState(e.target.value.toUpperCase())} className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-telivity-teal uppercase bg-white" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-telivity-slate mb-1">{t('frontDesk.originCountry')}</label>
                        <input type="text" maxLength={2} value={originCountry} onChange={(e) => setOriginCountry(e.target.value.toUpperCase())} placeholder="BR" className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-telivity-teal uppercase bg-white" />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-telivity-slate mb-1">{t('frontDesk.destinationCity')}</label>
                        <input type="text" value={destinationCity} onChange={(e) => setDestinationCity(e.target.value)} className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-telivity-teal bg-white" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-telivity-slate mb-1">{t('frontDesk.destinationState')}</label>
                        <input type="text" maxLength={2} value={destinationState} onChange={(e) => setDestinationState(e.target.value.toUpperCase())} className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-telivity-teal uppercase bg-white" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-telivity-slate mb-1">{t('frontDesk.destinationCountry')}</label>
                        <input type="text" maxLength={2} value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value.toUpperCase())} placeholder="BR" className="w-full border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-telivity-teal uppercase bg-white" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Room Assignment & Confirmation */}
              <div className="p-4 bg-gray-50/70 rounded-xl border border-gray-100 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-telivity-navy mb-1">
                    {t('frontDesk.assignRoom')}
                  </label>
                  <select
                    value={selectedRoom}
                    onChange={(e) => setSelectedRoom(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-telivity-teal focus:ring-2 focus:ring-telivity-teal/10 transition-all bg-white"
                  >
                    <option value="">{t('frontDesk.usePreAssignedRoom')}</option>
                    {roomList
                      .filter((room) => !checkInModal.roomTypeId || !room.roomTypeId || room.roomTypeId === checkInModal.roomTypeId)
                      .map((room) => (
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

                <label className="flex items-center gap-2 text-xs font-semibold text-telivity-navy pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={registrationSigned}
                    onChange={(e) => setRegistrationSigned(e.target.checked)}
                    className="rounded border-gray-300 text-telivity-teal focus:ring-telivity-teal"
                  />
                  {t('frontDesk.registrationSigned')}
                  {registrationRequired && (
                    <span className="text-telivity-orange text-[11px]">({t('common.required')})</span>
                  )}
                </label>
              </div>
            </div>

            {(() => {
              const mates = arrList.filter(
                (r) => r.id !== checkInModal.id && partyKey(r) === partyKey(checkInModal),
              );
              if (mates.length === 0) return null;
              const visible = mates.slice(0, MAX_FRONT_DESK_PARTY_ROOMS - 1);
              return (
                <div className="p-4 bg-gray-50/70 rounded-xl border border-gray-100 space-y-2">
                  <h3 className="text-xs font-bold text-telivity-navy uppercase tracking-wider">
                    {t('frontDesk.partyRoomsSection', { count: MAX_FRONT_DESK_PARTY_ROOMS })}
                  </h3>
                  <p className="text-xs text-telivity-mid-grey">{t('frontDesk.partyRoomsHint')}</p>
                  {visible.map((mate) => {
                    const included = checkInIncludeIds.includes(mate.id);
                    return (
                      <div
                        key={mate.id}
                        className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
                      >
                        <label className="flex items-center gap-2 text-sm text-telivity-navy min-w-[10rem]">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (checkInIncludeIds.length >= MAX_FRONT_DESK_PARTY_ROOMS - 1) return;
                                setCheckInIncludeIds([...checkInIncludeIds, mate.id]);
                              } else {
                                setCheckInIncludeIds(
                                  checkInIncludeIds.filter((id) => id !== mate.id),
                                );
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                          {guestName(mate)}
                        </label>
                        <select
                          value={checkInPartyRooms[mate.id] ?? ''}
                          disabled={!included}
                          onChange={(e) =>
                            setCheckInPartyRooms((prev) => ({
                              ...prev,
                              [mate.id]: e.target.value,
                            }))
                          }
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                        >
                          <option value="">
                            {mate.roomNumber
                              ? t('frontDesk.preAssignedRoom', { room: mate.roomNumber })
                              : t('frontDesk.usePreAssignedRoom')}
                          </option>
                          {roomList.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.roomNumber ?? room.number} — {formatLabel(room.status, t)}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                  {mates.length > visible.length && (
                    <p className="text-xs text-telivity-orange">
                      {t('frontDesk.partyRoomOverflow', { count: MAX_FRONT_DESK_PARTY_ROOMS })}
                    </p>
                  )}
                </div>
              );
            })()}

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
                    idCountry: idCountry || undefined,
                    idExpiry: idExpiry || undefined,
                    registrationSigned,
                    registrationData: {
                      nationality: regNationality,
                      address: regAddress,
                      travelReason,
                      transportationMode,
                      originCity,
                      originState,
                      originCountry,
                      destinationCity,
                      destinationState,
                      destinationCountry,
                    },
                    party: checkInIncludeIds.map((reservationId) => ({
                      reservationId,
                      roomId: checkInPartyRooms[reservationId] || undefined,
                    })),
                  })
                }
                disabled={
                  checkInMutation.isPending || (registrationRequired && !registrationSigned)
                }
                className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors disabled:opacity-50"
              >
                {checkInMutation.isPending
                  ? t('frontDesk.checkingIn')
                  : checkInIncludeIds.length > 0
                    ? t('frontDesk.confirmCheckInParty', {
                        count: 1 + checkInIncludeIds.length,
                      })
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
                {roomList
                  .filter((room) => room.id !== moveModal.roomId)
                  .filter((room) => !moveModal.roomTypeId || !room.roomTypeId || room.roomTypeId === moveModal.roomTypeId)
                  .map((room) => (
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
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-telivity-mid-grey">
              {t('frontDesk.room')} 1
            </p>
            <FindGuest
              label={t('reservations.guest')}
              selectedGuest={wiGuest}
              onSelectGuest={setWiGuest}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                  onChange={(e) => {
                    const next = e.target.value;
                    setWiRoomId(next);
                    setWiExtraRooms((prev) =>
                      prev.map((r) => (r.roomId === next ? { ...r, roomId: '' } : r)),
                    );
                  }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">{t('frontDesk.selectRoom')}</option>
                  {walkInRooms
                    .filter((room) => !takenRoomIds().has(room.id) || room.id === wiRoomId)
                    .map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.roomNumber ?? room.number} — {formatLabel(room.status, t)}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          {wiExtraRooms.map((extra, idx) => {
            const plans = plansForRoomType(extra.roomTypeId);
            const rooms = roomsForExtra(extra);
            return (
              <div key={extra.key} className="space-y-3 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-telivity-mid-grey">
                    {t('frontDesk.room')} {idx + 2}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeExtraRoom(extra.key)}
                    className="text-xs text-telivity-mid-grey hover:text-telivity-orange"
                  >
                    {t('common.remove')}
                  </button>
                </div>
                <FindGuest
                  label={t('frontDesk.partyGuest', { room: idx + 2 })}
                  selectedGuest={extra.guest}
                  onSelectGuest={(guest) => updateExtraRoom(extra.key, { guest })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                      {t('frontDesk.roomType')}
                    </label>
                    <select
                      value={extra.roomTypeId}
                      onChange={(e) =>
                        updateExtraRoom(extra.key, {
                          roomTypeId: e.target.value,
                          ratePlanId: '',
                          roomId: '',
                        })
                      }
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
                      value={extra.ratePlanId}
                      onChange={(e) => updateExtraRoom(extra.key, { ratePlanId: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">{t('frontDesk.selectRatePlan')}</option>
                      {plans.map((rp) => (
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
                      value={extra.roomId}
                      onChange={(e) => updateExtraRoom(extra.key, { roomId: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">{t('frontDesk.selectRoom')}</option>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.roomNumber ?? room.number} — {formatLabel(room.status, t)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}

          {1 + wiExtraRooms.length < MAX_FRONT_DESK_PARTY_ROOMS ? (
            <button
              type="button"
              onClick={() =>
                setWiExtraRooms((prev) => [
                  ...prev,
                  emptyWalkInExtraRoom({ roomTypeId: wiRoomTypeId, ratePlanId: wiRatePlanId }),
                ])
              }
              className="text-sm font-semibold text-telivity-teal hover:underline"
            >
              {t('frontDesk.addAnotherRoom')}
            </button>
          ) : (
            <p className="text-xs text-telivity-mid-grey">
              {t('frontDesk.partyRoomLimit', { count: MAX_FRONT_DESK_PARTY_ROOMS })}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('frontDesk.arrival')}
              </label>
              <input
                type="date"
                value={wiArrivalDate}
                onChange={(e) => setWiArrivalDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                {t('frontDesk.departure')}
              </label>
              <input
                type="date"
                value={wiDepartureDate}
                min={wiArrivalDate}
                onChange={(e) => setWiDepartureDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-telivity-mid-grey">
            {t('frontDesk.walkInStay', {
              checkIn: wiArrivalDate,
              checkOut: wiDepartureDate,
              count: Math.max(wiNights, 0),
            })}
            {wiExtraRooms.length > 0
              ? ` · ${t('frontDesk.partyRooms', { count: 1 + wiExtraRooms.length })}`
              : ''}
          </p>
          {wiError && <p className="text-sm text-telivity-orange">{wiError}</p>}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setWalkInOpen(false)}
              className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-semibold"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => walkInMutation.mutate()}
              disabled={walkInMutation.isPending}
              className="flex-[1.4] bg-telivity-teal text-white rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {walkInMutation.isPending
                ? t('common.processing')
                : wiExtraRooms.length > 0
                  ? t('frontDesk.createWalkInParty', { count: 1 + wiExtraRooms.length })
                  : t('frontDesk.createWalkIn')}
            </button>
          </div>
        </div>
      </Modal>

      <GuestDetailsModal
        open={!!detailsModal}
        reservation={detailsModal}
        propertyId={propertyId}
        doorPin={detailsModal ? doorPinByReservation.get(detailsModal.id)?.accessCode : null}
        onClose={() => setDetailsModal(null)}
        onNotes={(r) => {
          setDetailsModal(null);
          setNotesModal(r as Reservation);
          setNoteBody('');
        }}
        onMove={(r) => {
          setDetailsModal(null);
          setMoveModal(r as Reservation);
          setMoveRoomId('');
          setOverrideDoNotMove(false);
          setMoveReason('');
        }}
        onCheckIn={(r) => {
          setDetailsModal(null);
          void openCheckIn(r as Reservation);
        }}
        onCheckOut={(r) => {
          setDetailsModal(null);
          setCheckOutModal(r as Reservation);
        }}
        guestLabel={(r) => guestName(r as Reservation)}
      />

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
