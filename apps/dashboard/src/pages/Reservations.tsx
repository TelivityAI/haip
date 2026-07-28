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
import { CalendarDays, Plus, ChevronLeft, ChevronRight, ArrowUpDown, X, MoreHorizontal, Eye, Pencil, Ban, DoorOpen, LogIn, LogOut, Upload, UserX, Trash2, Check } from 'lucide-react';
import { format, addDays, eachDayOfInterval } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { moneyString, requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../components/ui/Toast';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import FindGuest from '../components/guests/FindGuest';
import type { Guest } from '../types/guest';

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


/** Statuses that a bulk action can still move. */
const BULK_ELIGIBLE: Record<'check_in' | 'check_out' | 'cancel', string[]> = {
  check_in: ['confirmed', 'assigned'],
  check_out: ['checked_in', 'stayover', 'due_out'],
  cancel: ['pending', 'confirmed', 'assigned'],
};

/**
 * Parse the reservation-import textarea. The API takes pre-parsed JSON rows, so
 * this accepts either a JSON array or one CSV row per line with the columns:
 * guestId,arrivalDate,departureDate,roomTypeId,ratePlanId,totalAmount,currencyCode,source,adults,children
 */
function parseImportRows(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of rows');
    return parsed;
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        guestId,
        arrivalDate,
        departureDate,
        roomTypeId,
        ratePlanId,
        totalAmount,
        currencyCode,
        source,
        adults,
        children,
      ] = line.split(',').map((s) => s.trim());
      const row: Record<string, unknown> = {
        guestId,
        arrivalDate,
        departureDate,
        roomTypeId,
        ratePlanId,
        totalAmount: totalAmount ? moneyString(totalAmount) : undefined,
        currencyCode: currencyCode || 'USD',
        source: source || 'direct',
      };
      if (adults) row.adults = Number(adults);
      if (children) row.children = Number(children);
      return row;
    });
}

// ---- Reservation List ----
function ReservationList() {
  const { t } = useTranslation();
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
  const { toast } = useToast();

  // Bulk actions + import
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<'check_in' | 'check_out' | 'cancel' | ''>('');
  const [bulkReason, setBulkReason] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<
    { created: number; failed: number; results: { index: number; error?: string }[] } | null
  >(null);

  // Create wizard state
  const [createStep, setCreateStep] = useState(0);
  const [createCheckIn, setCreateCheckIn] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [createCheckOut, setCreateCheckOut] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [createAdults, setCreateAdults] = useState(1);
  const [createChildren, setCreateChildren] = useState(0);
  const [availResults, setAvailResults] = useState<{ roomTypeId: string; roomTypeName: string; ratePlans: { id: string; name: string; rate: number }[] }[]>([]);
  const [selectedRoomType, setSelectedRoomType] = useState('');
  const [selectedRatePlan, setSelectedRatePlan] = useState('');
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);

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

  // Memoised so the `columns` memo below keeps a stable identity between
  // renders — its cell renderers are the element *type* passed to flexRender,
  // so a new identity remounts every cell (and drops in-flight interactions).
  const reservations: Reservation[] = useMemo(() => data?.data ?? data ?? [], [data]);

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
      if (!selectedGuest?.id) {
        throw new Error('Guest is required');
      }
      const guestId = selectedGuest.id;
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

  const noShowMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/v1/reservations/${id}/no-show`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      toast('success', t('reservations.noShowMarked'));
    },
  });

  // Only reservations whose current status the chosen action can actually move.
  const eligibleSelected = bulkAction
    ? reservations.filter((r) => selectedIds.includes(r.id) && BULK_ELIGIBLE[bulkAction].includes(r.status))
    : [];

  /** Bulk check-in / check-out / cancel — the API allows partial success. */
  const bulkMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(
        '/v1/reservations/bulk-action',
        {
          ids: eligibleSelected.map((r) => r.id),
          action: bulkAction,
          ...(bulkAction === 'cancel' && bulkReason.trim() ? { reason: bulkReason.trim() } : {}),
        },
        { params: { propertyId } },
      );
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      const body = res.data?.data ?? res.data ?? {};
      const succeeded = body.succeeded ?? 0;
      const failed = body.failed ?? 0;
      toast(
        failed > 0 ? 'error' : 'success',
        t('reservations.bulkResult', { succeeded, failed }),
      );
      setSelectedIds([]);
      setBulkAction('');
      setBulkReason('');
    },
  });

  const importMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      const rows = parseImportRows(importText);
      if (rows.length === 0) throw new Error('No rows to import');
      return api.post('/v1/reservations/import', { propertyId, rows });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setImportResult(res.data?.data ?? res.data ?? null);
    },
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
    setSelectedGuest(null);
    setCreateStep(0);
  }

  function guestName(r: Reservation) {
    if (r.guestName) return r.guestName;
    if (r.guest) return `${r.guest.firstName} ${r.guest.lastName}`;
    return '—';
  }

  const pageIds = useMemo(() => reservations.map((r) => r.id), [reservations]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((rid) => selectedIds.includes(rid));
  const cancelReservation = cancelMutation.mutate;
  const markNoShow = noShowMutation.mutate;

  const columns = useMemo<ColumnDef<Reservation>[]>(() => [
    {
      id: 'select',
      size: 36,
      // NOTE: no stopPropagation here — React derives a checkbox's onChange from
      // the click event, so stopping it would swallow the change. The row and
      // header handlers skip clicks tagged with data-row-select instead.
      header: () => (
        <input
          type="checkbox"
          data-row-select
          checked={allOnPageSelected}
          onChange={(e) => setSelectedIds(e.target.checked ? pageIds : [])}
          aria-label={t('reservations.selectAll')}
          className="rounded border-gray-300 text-telivity-teal"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          data-row-select
          checked={selectedIds.includes(row.original.id)}
          onChange={(e) =>
            setSelectedIds((prev) =>
              e.target.checked ? [...prev, row.original.id] : prev.filter((rid) => rid !== row.original.id),
            )
          }
          aria-label={t('reservations.selectRow')}
          className="rounded border-gray-300 text-telivity-teal"
        />
      ),
    },
    { accessorKey: 'confirmationNumber', header: t('reservations.confirmation'), size: 140 },
    { id: 'guest', header: t('reservations.guest'), cell: ({ row }) => guestName(row.original) },
    { accessorKey: 'roomTypeName', header: t('reservations.roomType'), cell: ({ getValue }) => (getValue() as string) ?? '—' },
    { accessorKey: 'roomNumber', header: t('reservations.roomNumber'), cell: ({ getValue }) => (getValue() as string) ?? '—', size: 80 },
    { accessorKey: 'arrivalDate', header: t('reservations.arrival'), size: 110 },
    { accessorKey: 'departureDate', header: t('reservations.departure'), size: 110 },
    {
      accessorKey: 'status', header: t('reservations.status'), cell: ({ getValue }) => {
        const status = getValue() as string;
        return <StatusBadge status={status} label={t(`reservations.statuses.${status}`, { defaultValue: status })} />;
      }, size: 120
    },
    { accessorKey: 'totalAmount', header: t('reservations.total'), cell: ({ getValue }) => getValue() != null ? `$${Number(getValue()).toFixed(2)}` : '—', size: 100 },
    { accessorKey: 'source', header: t('reservations.source'), cell: ({ getValue }) => (getValue() as string) ?? 'direct', size: 90 },
    {
      id: 'actions',
      header: t('reservations.actions'),
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
                <Eye size={14} /> {t('reservations.viewDetails')}
              </button>
              {row.original.status === 'pending' && (
                <button onClick={() => { api.patch(`/v1/reservations/${row.original.id}/confirm`).then(() => queryClient.invalidateQueries({ queryKey: ['reservations'] })); setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                  <Pencil size={14} /> {t('reservations.confirm')}
                </button>
              )}
              {['confirmed', 'assigned'].includes(row.original.status) && (
                <button onClick={() => { setActionMenu(null); navigate('/front-desk'); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                  <LogIn size={14} /> {t('reservations.checkIn')}
                </button>
              )}
              {row.original.status === 'checked_in' && (
                <button onClick={() => { api.patch(`/v1/reservations/${row.original.id}/check-out`, {}).then(() => queryClient.invalidateQueries({ queryKey: ['reservations'] })); setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                  <LogOut size={14} /> {t('reservations.checkOut')}
                </button>
              )}
              {['confirmed', 'assigned', 'pending'].includes(row.original.status) && (
                <button onClick={() => { if (confirm(t('reservations.confirmNoShow'))) { markNoShow(row.original.id); } setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-telivity-light-grey flex items-center gap-2">
                  <UserX size={14} /> {t('reservations.markNoShow')}
                </button>
              )}
              {!['cancelled', 'checked_out', 'no_show'].includes(row.original.status) && (
                <button onClick={() => { if (confirm(t('reservations.confirmCancellation'))) { cancelReservation(row.original.id); } setActionMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-telivity-orange hover:bg-telivity-light-grey flex items-center gap-2">
                  <Ban size={14} /> {t('common.cancel')}
                </button>
              )}
            </div>
          )}
        </div>
      ),
    },
  ], [actionMenu, queryClient, navigate, cancelReservation, markNoShow, selectedIds, allOnPageSelected, pageIds, t]);

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
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('reservations.selectProperty')}</div>;
  }

  return (
    <div onClick={() => setActionMenu(null)}>
      <div className="flex items-center gap-3 mb-6">
        <CalendarDays size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('reservations.title')}</h1>
        <div className="ml-auto flex gap-2 flex-wrap">
          <button onClick={() => navigate('/reservations/unassigned')} className="border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors">
            {t('reservations.unassignedQueue')}
          </button>
          <button onClick={() => { setImportText(''); setImportResult(null); setImportOpen(true); }} className="flex items-center gap-2 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors">
            <Upload size={16} /> {t('reservations.import')}
          </button>
          <button onClick={() => navigate('/reservations/calendar')} className="border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey transition-colors">
            {t('reservations.calendar')}
          </button>
          <button onClick={() => { resetCreateForm(); setCreateOpen(true); }} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors">
            <Plus size={16} /> {t('reservations.newReservation')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.status')}</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
            <option value="">{t('reservations.all')}</option>
            <option value="pending">{t('reservations.statuses.pending')}</option>
            <option value="confirmed">{t('reservations.statuses.confirmed')}</option>
            <option value="checked_in">{t('reservations.statuses.checked_in')}</option>
            <option value="checked_out">{t('reservations.statuses.checked_out')}</option>
            <option value="cancelled">{t('reservations.statuses.cancelled')}</option>
            <option value="no_show">{t('reservations.statuses.no_show')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.from')}</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.to')}</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
        </div>
        {(statusFilter || dateFrom || dateTo) && (
          <button onClick={() => { setStatusFilter(''); setDateFrom(''); setDateTo(''); }} className="p-2 text-telivity-mid-grey hover:text-telivity-orange">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="bg-telivity-navy text-white rounded-xl shadow-sm p-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{t('reservations.selectedCount', { count: selectedIds.length })}</span>
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value as typeof bulkAction)}
            aria-label={t('reservations.chooseBulkAction')}
            className="border border-white/30 bg-telivity-navy rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">{t('reservations.chooseBulkAction')}</option>
            <option value="check_in">{t('reservations.bulkCheckIn')}</option>
            <option value="check_out">{t('reservations.bulkCheckOut')}</option>
            <option value="cancel">{t('reservations.bulkCancel')}</option>
          </select>
          {bulkAction === 'cancel' && (
            <input
              type="text"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder={t('reservations.cancellationReason')}
              className="border border-white/30 bg-telivity-navy rounded-lg px-3 py-1.5 text-sm placeholder-white/50"
            />
          )}
          {bulkAction && (
            <span className="text-xs text-white/70">
              {t('reservations.bulkEligible', { eligible: eligibleSelected.length, total: selectedIds.length })}
            </span>
          )}
          <button
            onClick={() => bulkMutation.mutate()}
            disabled={!bulkAction || eligibleSelected.length === 0 || bulkMutation.isPending}
            className="ml-auto flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            <Check size={14} /> {t('reservations.applyBulk')}
          </button>
          <button onClick={() => { setSelectedIds([]); setBulkAction(''); }} className="p-1.5 rounded hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-telivity-teal/5 border-b border-gray-100">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider cursor-pointer select-none"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-row-select]')) return;
                      h.column.getToggleSortingHandler()?.(e);
                    }}
                  >
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
              <tr
                key={row.id}
                className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors cursor-pointer`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('[data-row-select]')) return;
                  setDetailRes(row.original);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-sm">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {reservations.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('reservations.empty')}</td></tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {table.getPageCount() > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-telivity-mid-grey">
              {t('reservations.pagination', { page: table.getState().pagination.pageIndex + 1, total: table.getPageCount(), count: reservations.length })}
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
              <h2 className="text-lg font-semibold text-telivity-navy">{t('reservations.details')}</h2>
              <button onClick={() => setDetailRes(null)} className="p-1 rounded hover:bg-telivity-light-grey"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-telivity-navy">{detailRes.confirmationNumber}</span>
                <StatusBadge status={detailRes.status} label={t(`reservations.statuses.${detailRes.status}`, { defaultValue: detailRes.status })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Detail label={t('reservations.guest')} value={guestName(detailRes)} />
                <Detail label={t('reservations.source')} value={detailRes.source ?? 'direct'} />
                <Detail label={t('reservations.arrival')} value={detailRes.arrivalDate} />
                <Detail label={t('reservations.departure')} value={detailRes.departureDate} />
                <Detail label={t('reservations.roomType')} value={detailRes.roomTypeName ?? '—'} />
                <Detail label={t('reservations.room')} value={detailRes.roomNumber ?? t('reservations.unassigned')} />
                <Detail label={t('reservations.adults')} value={String(detailRes.adults)} />
                <Detail label={t('reservations.children')} value={String(detailRes.children ?? 0)} />
                <Detail label={t('reservations.total')} value={detailRes.totalAmount != null ? `$${Number(detailRes.totalAmount).toFixed(2)}` : '—'} />
                <Detail label={t('reservations.ratePlan')} value={detailRes.ratePlanName ?? '—'} />
              </div>
              {detailRes.notes && (
                <div>
                  <p className="text-xs text-telivity-mid-grey mb-1">{t('reservations.notes')}</p>
                  <p className="text-sm bg-telivity-light-grey rounded-lg p-3">{detailRes.notes}</p>
                </div>
              )}
              <ReservationOpsNotes reservationId={detailRes.id} propertyId={propertyId!} />
              <ReservationMessageCompose reservationId={detailRes.id} propertyId={propertyId!} />
              <div className="flex gap-2 pt-2">
                {detailRes.guestId && (
                  <button onClick={() => { navigate(`/guests/${detailRes.guestId}`); setDetailRes(null); }} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-light-grey">
                    {t('reservations.viewGuest')}
                  </button>
                )}
                <button onClick={() => { navigate(`/folios?reservationId=${detailRes.id}`); setDetailRes(null); }} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-3 py-2 text-sm font-semibold hover:bg-telivity-light-grey">
                  {t('reservations.viewFolio')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Reservations Modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={t('reservations.importReservations')} wide>
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('reservations.importHint')}</p>
          <textarea
            value={importText}
            onChange={(e) => { setImportText(e.target.value); setImportResult(null); }}
            rows={8}
            placeholder={'<guestId>,2026-06-01,2026-06-04,<roomTypeId>,<ratePlanId>,599.00,USD,direct,2,0'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
          />
          {importResult && (
            <div className="rounded-lg border border-gray-200 p-3 text-sm space-y-1 max-h-48 overflow-y-auto">
              <p className="font-semibold text-telivity-navy">
                {t('reservations.importResult', { created: importResult.created, failed: importResult.failed })}
              </p>
              {importResult.results
                .filter((r) => r.error)
                .map((r) => (
                  <p key={r.index} className="text-xs text-red-600">
                    {t('reservations.importRowError', { row: r.index + 1, error: r.error })}
                  </p>
                ))}
            </div>
          )}
          <button
            onClick={() => importMutation.mutate()}
            disabled={!importText.trim() || importMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {importMutation.isPending ? t('reservations.importing') : t('reservations.importReservations')}
          </button>
        </div>
      </Modal>

      {/* Create Reservation Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('reservations.newReservation')} wide>
        {createStep === 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">{t('reservations.searchAvailabilityStep')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.checkIn')}</label>
                <input type="date" value={createCheckIn} onChange={(e) => setCreateCheckIn(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.checkOut')}</label>
                <input type="date" value={createCheckOut} onChange={(e) => setCreateCheckOut(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.adults')}</label>
                <input type="number" min={1} value={createAdults} onChange={(e) => setCreateAdults(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.children')}</label>
                <input type="number" min={0} value={createChildren} onChange={(e) => setCreateChildren(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
            </div>
            <button onClick={() => searchAvailMutation.mutate()} disabled={searchAvailMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50">
              {searchAvailMutation.isPending ? t('reservations.searching') : t('reservations.searchAvailability')}
            </button>
          </div>
        )}

        {createStep === 1 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">{t('reservations.selectRoomRateStep')}</h3>
            {availResults.length === 0 ? (
              <p className="text-sm text-telivity-mid-grey">{t('reservations.noAvailability')}</p>
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
              <button onClick={() => setCreateStep(0)} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">{t('reservations.back')}</button>
              <button onClick={() => setCreateStep(2)} disabled={!selectedRatePlan} className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('reservations.next')}</button>
            </div>
          </div>
        )}

        {createStep === 2 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">{t('reservations.guestDetailsStep')}</h3>
            <FindGuest
              selectedGuest={selectedGuest}
              onSelectGuest={setSelectedGuest}
            />
            <div className="flex gap-3">
              <button onClick={() => setCreateStep(1)} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">{t('reservations.back')}</button>
              <button onClick={() => setCreateStep(3)} disabled={!selectedGuest} className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('reservations.review')}</button>
            </div>
          </div>
        )}

        {createStep === 3 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-telivity-navy">{t('reservations.reviewConfirmStep')}</h3>
            <div className="bg-telivity-light-grey rounded-lg p-4 space-y-2 text-sm">
              <p><span className="text-telivity-mid-grey">{t('reservations.guest')}:</span> {selectedGuest?.firstName} {selectedGuest?.lastName}</p>
              <p><span className="text-telivity-mid-grey">{t('reservations.dates')}:</span> {createCheckIn} → {createCheckOut}</p>
              <p><span className="text-telivity-mid-grey">{t('reservations.occupancy')}:</span> {t('reservations.occupancySummary', { adults: createAdults, children: createChildren })}</p>
              {selectedGuest?.email && <p><span className="text-telivity-mid-grey">{t('common.email')}:</span> {selectedGuest.email}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setCreateStep(2)} className="flex-1 border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">{t('reservations.back')}</button>
              <button onClick={() => createResMutation.mutate()} disabled={createResMutation.isPending} className="flex-1 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {createResMutation.isPending ? t('common.creating') : t('reservations.createAndConfirm')}
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
  const { t } = useTranslation();
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
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/reservations')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <ChevronLeft size={20} />
        </button>
        <CalendarDays size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('reservations.availabilityCalendar')}</h1>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setStartDate(addDays(startDate, -7))} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-telivity-light-grey">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => setStartDate(new Date())} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm hover:bg-telivity-light-grey">
            {t('reservations.today')}
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
              <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate w-24 sticky left-0 bg-telivity-teal/5">{t('reservations.room')}</th>
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
              <tr><td colSpan={15} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('rooms.noRoomsFound')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Unassigned Queue ----
/**
 * Assignable-but-unassigned reservations (confirmed/assigned with no room).
 * The API filters this window with `from` / `to`, not the list endpoint's
 * arrivalDateFrom / arrivalDateTo.
 */
function UnassignedQueue() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [from, setFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [assignFor, setAssignFor] = useState<Reservation | null>(null);
  const [assignRoomId, setAssignRoomId] = useState('');

  const { data } = useQuery({
    queryKey: ['reservations', 'unassigned', propertyId, from, to],
    queryFn: () =>
      api
        .get('/v1/reservations/unassigned', { params: { propertyId, from, to } })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: roomsData } = useQuery({
    queryKey: ['rooms', propertyId, 'available'],
    queryFn: () =>
      api.get('/v1/rooms', { params: { propertyId, status: 'available' } }).then((r) => r.data),
    enabled: !!propertyId && !!assignFor,
  });

  const rows: (Reservation & { reasonHint?: string })[] = data?.data ?? (Array.isArray(data) ? data : []);
  const total = data?.total ?? rows.length;
  const rooms: { id: string; number: string; roomTypeId?: string }[] = roomsData?.data ?? roomsData ?? [];
  // Prefer rooms matching the reservation's room type; fall back to all available.
  const matchingRooms = assignFor?.roomTypeId
    ? rooms.filter((r) => !r.roomTypeId || r.roomTypeId === assignFor.roomTypeId)
    : rooms;

  const assignMutation = useMutation({
    mutationFn: () =>
      api.patch(`/v1/reservations/${assignFor!.id}/assign-room`, { roomId: assignRoomId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setAssignFor(null);
      setAssignRoomId('');
      toast('success', t('reservations.roomAssigned'));
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/reservations')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <ChevronLeft size={20} />
        </button>
        <DoorOpen size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('reservations.unassignedQueue')}</h1>
        <span className="rounded-full bg-telivity-orange/15 text-telivity-orange text-xs font-semibold px-2.5 py-1">
          {total}
        </span>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.from')}</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reservations.to')}</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('reservations.confirmation')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('reservations.guest')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('reservations.roomType')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('reservations.arrival')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('reservations.status')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('reservations.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{r.confirmationNumber}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{r.guestName ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{r.roomTypeName ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{r.arrivalDate}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} label={t(`reservations.statuses.${r.status}`, { defaultValue: r.status })} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => { setAssignFor(r); setAssignRoomId(''); }}
                    className="text-xs font-semibold text-telivity-teal hover:underline"
                  >
                    {t('reservations.assignRoom')}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('reservations.noUnassigned')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title={t('reservations.assignRoom')}>
        <div className="space-y-4">
          <p className="text-sm text-telivity-mid-grey">
            {assignFor?.confirmationNumber} · {assignFor?.roomTypeName ?? '—'}
          </p>
          <select value={assignRoomId} onChange={(e) => setAssignRoomId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">{t('reservations.selectRoom')}</option>
            {matchingRooms.map((room) => (
              <option key={room.id} value={room.id}>{room.number}</option>
            ))}
          </select>
          {matchingRooms.length === 0 && (
            <p className="text-xs text-telivity-mid-grey">{t('reservations.noAvailableRooms')}</p>
          )}
          <button
            onClick={() => assignMutation.mutate()}
            disabled={!assignRoomId || assignMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('reservations.assign')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Router ----
function ReservationMessageCompose({
  reservationId,
  propertyId,
}: {
  reservationId: string;
  propertyId: string;
}) {
  const { t } = useTranslation();
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isMarketing, setIsMarketing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/reservations/${reservationId}/messages`,
        {
          propertyId,
          channel,
          ...(channel === 'email' ? { subject: subject.trim() } : {}),
          body: body.trim(),
          isMarketing,
        },
        { skipErrorToast: true },
      ),
    onSuccess: (res) => {
      const sent = res.data?.sent ?? res.data?.data?.sent;
      if (channel === 'sms') {
        setStatus(sent ? t('reservations.smsSent') : t('reservations.smsDrafted'));
      } else {
        setStatus(sent ? t('reservations.messageSent') : t('reservations.messageDrafted'));
      }
      setSubject('');
      setBody('');
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setStatus(msg ?? t('reservations.messageFailed'));
    },
  });

  const canSend =
    body.trim().length > 0 && (channel === 'sms' || subject.trim().length > 0) && !send.isPending;

  return (
    <div className="space-y-2 border-t border-gray-100 pt-4">
      <p className="text-xs font-medium text-telivity-mid-grey">{t('reservations.guestMessage')}</p>
      <label className="block text-xs text-telivity-navy">
        <span className="sr-only">{t('reservations.messageChannel')}</span>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as 'email' | 'sms')}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="email">{t('reservations.messageChannelEmail')}</option>
          <option value="sms">{t('reservations.messageChannelSms')}</option>
        </select>
      </label>
      {channel === 'email' && (
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t('reservations.messageSubject')}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        placeholder={t('reservations.messageBody')}
      />
      <label className="flex items-center gap-2 text-xs text-telivity-navy">
        <input
          type="checkbox"
          checked={isMarketing}
          onChange={(e) => setIsMarketing(e.target.checked)}
          className="rounded border-gray-300"
        />
        {t('reservations.marketingMessage')}
      </label>
      <button
        type="button"
        onClick={() => send.mutate()}
        disabled={!canSend}
        className="w-full bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {t('reservations.sendMessage')}
      </button>
      {status && <p className="text-xs text-telivity-mid-grey">{status}</p>}
    </div>
  );
}

function ReservationOpsNotes({
  reservationId,
  propertyId,
}: {
  reservationId: string;
  propertyId: string;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const { data, refetch } = useQuery({
    queryKey: ['reservation-notes', reservationId, propertyId],
    queryFn: () =>
      api
        .get(`/v1/reservations/${reservationId}/notes`, { params: { propertyId } })
        .then((r) => r.data),
    enabled: !!reservationId && !!propertyId,
  });
  const add = useMutation({
    mutationFn: () =>
      api.post(`/v1/reservations/${reservationId}/notes`, { propertyId, body: body.trim() }),
    onSuccess: () => {
      setBody('');
      refetch();
    },
  });
  // Note mutations live on the static /reservations/notes/:noteId routes.
  const update = useMutation({
    mutationFn: (payload: { noteId: string; body?: string; isActive?: boolean }) =>
      api.patch(
        `/v1/reservations/notes/${payload.noteId}`,
        {
          propertyId,
          ...(payload.body != null ? { body: payload.body } : {}),
          ...(payload.isActive != null ? { isActive: payload.isActive } : {}),
        },
        { params: { propertyId } },
      ),
    onSuccess: () => {
      setEditingId(null);
      setEditBody('');
      refetch();
    },
  });
  const remove = useMutation({
    mutationFn: (noteId: string) =>
      api.delete(`/v1/reservations/notes/${noteId}`, { params: { propertyId } }),
    onSuccess: () => refetch(),
  });
  const notes = data?.notes ?? data?.data ?? (Array.isArray(data) ? data : []);

  return (
    <div className="space-y-2 border-t border-gray-100 pt-4">
      <p className="text-xs font-medium text-telivity-mid-grey">{t('reservations.opsNotes')}</p>
      <ul className="space-y-1 max-h-48 overflow-y-auto">
        {notes.map((n: { id: string; body: string; isActive?: boolean }) => (
          <li key={n.id} className={`text-sm bg-telivity-light-grey rounded-lg p-2 ${n.isActive === false ? 'opacity-60' : ''}`}>
            {editingId === n.id ? (
              <div className="space-y-2">
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => update.mutate({ noteId: n.id, body: editBody.trim() })}
                    disabled={!editBody.trim() || update.isPending}
                    className="text-xs font-semibold text-telivity-teal hover:underline disabled:opacity-50"
                  >
                    {t('common.save')}
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-telivity-mid-grey hover:underline">
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words">{n.body}</span>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setEditingId(n.id); setEditBody(n.body); }}
                    aria-label={t('common.edit')}
                    className="text-telivity-slate hover:text-telivity-teal"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => update.mutate({ noteId: n.id, isActive: n.isActive === false })}
                    disabled={update.isPending}
                    className="text-[10px] text-telivity-mid-grey hover:underline disabled:opacity-50"
                  >
                    {n.isActive === false ? t('reservations.reactivateNote') : t('reservations.resolveNote')}
                  </button>
                  <button
                    onClick={() => { if (confirm(t('reservations.confirmDeleteNote'))) remove.mutate(n.id); }}
                    disabled={remove.isPending}
                    aria-label={t('common.delete')}
                    className="text-telivity-slate hover:text-telivity-orange disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-xs text-telivity-mid-grey">{t('reservations.noOpsNotes')}</li>
        )}
      </ul>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
        placeholder={t('reservations.addOpsNote')}
      />
      <button
        type="button"
        onClick={() => add.mutate()}
        disabled={!body.trim() || add.isPending}
        className="w-full border border-gray-200 text-telivity-slate rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey disabled:opacity-50"
      >
        {t('reservations.saveNote')}
      </button>
    </div>
  );
}

export default function Reservations() {
  return (
    <Routes>
      <Route index element={<ReservationList />} />
      <Route path="calendar" element={<AvailabilityCalendar />} />
      <Route path="unassigned" element={<UnassignedQueue />} />
    </Routes>
  );
}
