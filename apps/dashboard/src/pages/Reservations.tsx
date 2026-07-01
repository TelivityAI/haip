import { useState, useMemo } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { CalendarDays, Plus, ChevronLeft, ChevronRight, ArrowUpDown, X, MoreHorizontal, Eye, Pencil, Ban, DoorOpen, LogIn, LogOut } from 'lucide-react';
import { format, addDays, eachDayOfInterval } from 'date-fns';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

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
  ratePlanId?: string;
  ratePlanName?: string;
  guestId?: string;
  guestName?: string;
  guest?: { id: string; firstName: string; lastName: string; email?: string };
  adults: number;
  children: number;
  totalAmount?: number;
  source?: string;
  notes?: string;
  createdAt?: string;
}

// ---- Reservation List ----
function ReservationList() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRes, setDetailRes] = useState<Reservation | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  // Create wizard state
  const [createStep, setCreateStep] = useState(0);
  const [createCheckIn, setCreateCheckIn] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [createCheckOut, setCreateCheckOut] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [createAdults, setCreateAdults] = useState(1);
  const [createChildren, setCreateChildren] = useState(0);
  const [availResults, setAvailResults] = useState<{ roomTypeId: string; roomTypeName: string; ratePlans: { id: string; name: string; rate: number }[] }[]>([]);
  const [selectedRoomType, setSelectedRoomType] = useState('');
  const [selectedRatePlan, setSelectedRatePlan] = useState('');
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  const params: Record<string, string> = {};
  if (propertyId) params.propertyId = propertyId;
  if (statusFilter) params.status = statusFilter;
  if (dateFrom) params.arrivalDateFrom = dateFrom;
  if (dateTo) params.arrivalDateTo = dateTo;

  const { data } = useQuery({
    queryKey: ['reservations', params],
    queryFn: () => api.get('/v1/reservations', { params }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const reservations: Reservation[] = data?.data ?? data ?? [];

  const searchAvailMutation = useMutation({
    mutationFn: async () => {
      requirePropertyId(propertyId);
      const [availRes, rateRes] = await Promise.all([
        api.post('/v1/reservations/search-availability', {
          propertyId,
          checkIn: createCheckIn,
          checkOut: createCheckOut,
        }),
        api.get('/v1/rate-plans', { params: { propertyId } }),
      ]);
      const rows: { roomTypeId: string; roomTypeName: string; available: number }[] =
        availRes.data?.data ?? availRes.data ?? [];
      const ratePlans: { id: string; name: string; roomTypeId: string; baseAmount?: string | number }[] =
        rateRes.data?.data ?? rateRes.data ?? [];

      const byType = new Map<string, { roomTypeId: string; roomTypeName: string; minAvailable: number }>();
      for (const row of rows) {
        const existing = byType.get(row.roomTypeId);
        if (!existing) {
          byType.set(row.roomTypeId, {
            roomTypeId: row.roomTypeId,
            roomTypeName: row.roomTypeName,
            minAvailable: row.available,
          });
        } else {
          existing.minAvailable = Math.min(existing.minAvailable, row.available);
        }
      }

      return [...byType.values()]
        .filter((rt) => rt.minAvailable > 0)
        .map((rt) => ({
          roomTypeId: rt.roomTypeId,
          roomTypeName: rt.roomTypeName,
          ratePlans: ratePlans
            .filter((rp) => rp.roomTypeId === rt.roomTypeId)
            .map((rp) => ({
              id: rp.id,
              name: rp.name,
              rate: Number(rp.baseAmount ?? 0),
            })),
        }));
    },
    onSuccess: (grouped) => {
      setAvailResults(grouped);
      setCreateStep(1);
    },
  });

  const createResMutation = useMutation({
    mutationFn: async () => {
      requirePropertyId(propertyId);
      const guestRes = await api.post('/v1/guests', {
        firstName: guestFirstName,
        lastName: guestLastName,
        email: guestEmail || undefined,
        phone: guestPhone || undefined,
      });
      const guestId = guestRes.data?.id ?? guestRes.data?.data?.id;
      const nights = Math.max(
        1,
        Math.round(
          (new Date(createCheckOut).getTime() - new Date(createCheckIn).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      const selectedPlan = availResults
        .flatMap((rt) => rt.ratePlans)
        .find((rp) => rp.id === selectedRatePlan);
      const nightly = selectedPlan?.rate ?? 0;
      const totalAmount = moneyString(nightly * nights);

      return api.post('/v1/reservations', {
        propertyId,
        guestId,
        roomTypeId: selectedRoomType,
        ratePlanId: selectedRatePlan,
        arrivalDate: createCheckIn,
        departureDate: createCheckOut,
        adults: createAdults,
        children: createChildren,
        totalAmount,
        currencyCode: 'USD',
        source: 'direct',
      });
    },
    onSuccess: async (res) => {
      const id = res.data?.id ?? res.data?.data?.id;
      if (id) {
        await api.patch(`/v1/reservations/${id}/confirm`);
      }
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setCreateOpen(false);
      resetCreateForm();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/v1/reservations/${id}/cancel`, { cancellationReason: 'Cancelled by front desk' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reservations'] }),
  });

  function resetCreateForm() {
    setCreateStep(0);
    setCreateCheckIn(format(new Date(), 'yyyy-MM-dd'));
    setCreateCheckOut(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    setCreateAdults(1);
    setCreateChildren(0);
    setAvailResults([]);
    setSelectedRoomType('');
    setSelectedRatePlan('');
    setGuestFirstName('');
    setGuestLastName('');
    setGuestEmail('');
    setGuestPhone('');
  }

  function guestName(r: Reservation) {
    if (r.guestName) return r.guestName;
    if (r.guest) return `${r.guest.firstName} ${r.guest.lastName}`;
    return '—';
  }

  const columns = useMemo<ColumnDef<Reservation>[]>(() => [
    { accessorKey: 'confirmationNumber', header: 'Confirmation #', size: 140 },
    { id: 'guest', header: 'Guest', cell: ({ row }) => guestName(row.original) },
    { accessorKey: 'roomTypeName', header: 'Room Type', cell: ({ getValue }) => (getValue() as string) ?? '—' },
    { accessorKey: 'roomNumber', header: 'Room #', cell: ({ getValue }) => (getValue() as string) ?? '—', size: 80 },
    { accessorKey: 'arrivalDate', header: 'Arrival', size: 110 },
    { accessorKey: 'departureDate', header: 'Departure', size: 110 },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusBadge status={getValue() as string} />, size: 120 },
    { accessorKey: 'totalAmount', header: 'Total', cell: ({ getValue }) => getValue() != null ? `$${Number(getValue()).toFixed(2)}` : '—', size: 100 },
    { accessorKey: 'source', header: 'Source', cell: ({ getValue }) => (getValue() as string) ?? 'direct', size: 90 },
    {
      id: 'actions',
      header: '',
      size: 50,
      cell: ({ row }) => (
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setActionMenu(actionMenu === row.original.id ? null : row.original.id); }}
            className="p-1 rounded hover:bg-telivity-light-grey"
          >
            <MoreHorizontal size={16} />
          </button>
          {actionMenu === row.original.id && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1 w-40" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setDetailRes(row.original); setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                <Eye size={14} /> View Details
              </button>
              {row.original.status === 'pending' && (
                <button onClick={() => { api.patch(`/v1/reservations/${row.original.id}/confirm`).then(() => queryClient.invalidateQueries({ queryKey: ['reservations'] })); setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                  <Pencil size={14} /> Confirm
                </button>
              )}
              {['confirmed', 'assigned'].includes(row.original.status) && (
                <button onClick={() => { api.patch(`/v1/reservations/${row.original.id}/check-in`, {}).then(() => queryClient.invalidateQueries({ queryKey: ['reservations'] })); setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                  <LogIn size={14} /> Check In
                </button>
              )}
              {row.original.status === 'checked_in' && (
                <button onClick={() => { api.patch(`/v1/reservations/${row.original.id}/check-out`, {}).then(() => queryClient.invalidateQueries({ queryKey: ['reservations'] })); setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                  <LogOut size={14} /> Check Out
                </button>
              )}
              {!['cancelled', 'checked_out', 'no_show'].includes(row.original.status) && (
                <button onClick={() => { if (confirm('Cancel this reservation?')) { cancelMutation.mutate(row.original.id); } setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-telivity-orange hover:bg-telivity-light-grey flex items-center gap-2">
                  <Ban size={14} /> Cancel
                </button>
              )}
            </div>
          )}
        </div>
      ),
    },
  ], [actionMenu, queryClient, cancelMutation]);

  const table = useReactTable({
    data: reservations,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property to view reservations</div>;
  }

  return (
    <div onClick={() => setActionMenu(null)}>
      <div className="flex items-center gap-3 mb-6">
        <CalendarDays size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Reservations</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={() => navigate('/reservations/calendar')} className="border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors">
            Calendar
          </button>
          <button onClick={() => { resetCreateForm(); setCreateOpen(true); }} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors">
            <Plus size={16} /> New Reservation
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="checked_in">Checked In</option>
            <option value="checked_out">Checked Out</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
        </div>
        {(statusFilter || dateFrom || dateTo) && (
          <button onClick={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); }} className="p-2 text-telivity-mid-grey hover:text-telivity-orange">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-telivity-teal/5 border-b border-gray-100">
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider cursor-pointer select-none" onClick={h.column.getToggleSortingHandler()}>
                    <span className="flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() && <ArrowUpDown size={12} className="text-telivity-mid-grey" />}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr key={row.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors cursor-pointer`} onClick={() => setDetailRes(row.original)}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-sm">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {reservations.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No reservations found</td></tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {table.getPageCount() > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-telivity-mid-grey">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} ({reservations.length} results)
            </span>
            <div className="flex gap-1">
              <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="p-1.5 rounded hover:bg-telivity-light-grey disabled:opacity-30">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="p-1.5 rounded hover:bg-telivity-light-grey disabled:opacity-30">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Slide-Over */}
      {detailRes && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailRes(null)} />
          <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-telivity-navy">Reservation Details</h2>
              <button onClick={() => setDetailRes(null)} className="p-1 rounded hover:bg-telivity-light-grey"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-telivity-navy">{detailRes.confirmationNumber}</span>
                <StatusBadge status={detailRes.status} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Guest" value={guestName(detailRes)} />
                <Detail label="Source" value={detailRes.source ?? 'direct'} />
                <Detail label="Arrival" value={detailRes.arrivalDate} />
                <Detail label="Departure" value={detailRes.departureDate} />
                <Detail label="Room Type" value={detailRes.roomTypeName ?? '—'} />
                <Detail label="Room" value={detailRes.roomNumber ?? 'Unassigned'} />
                <Detail label="Adults" value={String(detailRes.adults)} />
                <Detail label="Children" value={String(detailRes.children ?? 0)} />
                <Detail label="Total" value={detailRes.totalAmount != null ? `$${Number(detailRes.totalAmount).toFixed(2)}` : '—'} />
                <Detail label="Rate Plan" value={detailRes.ratePlanName ?? '—'} />
              </div>
              {detailRes.notes && (
                <div>
                  <p className="text-xs text-telivity-mid-grey mb-1">Notes</p>
                  <p className="text-sm bg-telivity-light-grey rounded-lg p-3">{detailRes.notes}</p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                {detailRes.guestId && (
                  <button onClick={() => { navigate(`/guests/${detailRes.guestId}`); setDetailRes(null); }} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-light-grey">
                    View Guest
                  </button>
                )}
                <button onClick={() => { navigate(`/folios?reservationId=${detailRes.id}`); setDetailRes(null); }} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-light-grey">
                  View Folio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Reservation Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Reservation" wide>
        {createStep === 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">Step 1: Search Availability</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Check-In</label>
                <input type="date" value={createCheckIn} onChange={(e) => setCreateCheckIn(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Check-Out</label>
                <input type="date" value={createCheckOut} onChange={(e) => setCreateCheckOut(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Adults</label>
                <input type="number" min={1} value={createAdults} onChange={(e) => setCreateAdults(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Children</label>
                <input type="number" min={0} value={createChildren} onChange={(e) => setCreateChildren(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
            </div>
            <button onClick={() => searchAvailMutation.mutate()} disabled={searchAvailMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50">
              {searchAvailMutation.isPending ? 'Searching...' : 'Search Availability'}
            </button>
          </div>
        )}

        {createStep === 1 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">Step 2: Select Room & Rate</h3>
            {availResults.length === 0 ? (
              <p className="text-sm text-telivity-mid-grey">No availability found for these dates.</p>
            ) : (
              <div className="space-y-2">
                {availResults.map((rt) => (
                  <div key={rt.roomTypeId} className={`border rounded-lg p-3 cursor-pointer transition-colors ${selectedRoomType === rt.roomTypeId ? 'border-telivity-teal bg-telivity-teal/5' : 'border-gray-200 hover:border-telivity-teal/50'}`} onClick={() => setSelectedRoomType(rt.roomTypeId)}>
                    <p className="text-sm font-semibold text-telivity-navy">{rt.roomTypeName}</p>
                    <div className="mt-2 space-y-1">
                      {(rt.ratePlans ?? []).map((rp) => (
                        <label key={rp.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="radio" name="ratePlan" value={rp.id} checked={selectedRatePlan === rp.id} onChange={() => { setSelectedRoomType(rt.roomTypeId); setSelectedRatePlan(rp.id); }} className="text-telivity-teal" />
                          {rp.name} — ${rp.rate?.toFixed(2) ?? '—'}/night
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setCreateStep(0)} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">Back</button>
              <button onClick={() => setCreateStep(2)} disabled={!selectedRatePlan} className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Next</button>
            </div>
          </div>
        )}

        {createStep === 2 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">Step 3: Guest Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">First Name *</label>
                <input type="text" value={guestFirstName} onChange={(e) => setGuestFirstName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Last Name *</label>
                <input type="text" value={guestLastName} onChange={(e) => setGuestLastName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Email</label>
                <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Phone</label>
                <input type="tel" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCreateStep(1)} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">Back</button>
              <button onClick={() => setCreateStep(3)} disabled={!guestFirstName || !guestLastName} className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Review</button>
            </div>
          </div>
        )}

        {createStep === 3 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">Step 4: Review & Confirm</h3>
            <div className="bg-telivity-light-grey rounded-lg p-4 space-y-2 text-sm">
              <p><span className="text-telivity-mid-grey">Guest:</span> {guestFirstName} {guestLastName}</p>
              <p><span className="text-telivity-mid-grey">Dates:</span> {createCheckIn} → {createCheckOut}</p>
              <p><span className="text-telivity-mid-grey">Occupancy:</span> {createAdults} adults, {createChildren} children</p>
              {guestEmail && <p><span className="text-telivity-mid-grey">Email:</span> {guestEmail}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCreateStep(2)} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">Back</button>
              <button onClick={() => createResMutation.mutate()} disabled={createResMutation.isPending} className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {createResMutation.isPending ? 'Creating...' : 'Create & Confirm'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-telivity-mid-grey">{label}</p>
      <p className="text-sm font-medium text-telivity-navy">{value}</p>
    </div>
  );
}

// ---- Tape Chart / Calendar ----
function AvailabilityCalendar() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(new Date());
  const days = eachDayOfInterval({ start: startDate, end: addDays(startDate, 13) });

  const { data: roomsData } = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.get('/v1/rooms', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: resData } = useQuery({
    queryKey: ['reservations', 'calendar', propertyId, format(startDate, 'yyyy-MM-dd')],
    queryFn: () => api.get('/v1/reservations', {
      params: { propertyId, arrivalDateFrom: format(startDate, 'yyyy-MM-dd'), arrivalDateTo: format(addDays(startDate, 13), 'yyyy-MM-dd') },
    }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const rooms = roomsData?.data ?? roomsData ?? [];
  const reservations: Reservation[] = resData?.data ?? resData ?? [];

  function getResForCell(roomId: string, date: string) {
    return reservations.find((r) => r.roomId === roomId && r.arrivalDate <= date && r.departureDate > date);
  }

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/reservations')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <ChevronLeft size={20} />
        </button>
        <CalendarDays size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Availability Calendar</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setStartDate(addDays(startDate, -7))} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-telivity-light-grey">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => setStartDate(new Date())} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-telivity-light-grey">
            Today
          </button>
          <button onClick={() => setStartDate(addDays(startDate, 7))} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-telivity-light-grey">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate w-24 sticky left-0 bg-telivity-teal/5">Room</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="px-1 py-2 text-center text-xs font-medium text-telivity-slate min-w-[60px]">
                  <div>{format(d, 'EEE')}</div>
                  <div className="text-telivity-mid-grey">{format(d, 'd')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rooms as { id: string; number: string }[]).map((room, i) => (
              <tr key={room.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                <td className="px-3 py-2 text-xs font-medium text-telivity-navy sticky left-0 bg-white">{room.number}</td>
                {days.map((d) => {
                  const dateStr = format(d, 'yyyy-MM-dd');
                  const res = getResForCell(room.id, dateStr);
                  return (
                    <td key={dateStr} className={`px-0.5 py-2 text-center ${res ? '' : 'cursor-pointer hover:bg-telivity-teal/5'}`}>
                      {res ? (
                        <div className="bg-telivity-teal/20 text-telivity-navy text-[10px] font-medium rounded px-1 py-0.5 truncate" title={`${res.confirmationNumber}`}>
                          {res.confirmationNumber?.slice(-4) ?? '—'}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rooms.length === 0 && (
              <tr><td colSpan={15} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No rooms found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Router ----
export default function Reservations() {
  return (
    <Routes>
      <Route index element={<ReservationList />} />
      <Route path="calendar" element={<AvailabilityCalendar />} />
    </Routes>
  );
}
