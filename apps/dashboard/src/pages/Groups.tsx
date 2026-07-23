import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UsersRound, Plus, ChevronLeft, FileText, Receipt, Pencil, Link2 } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import { useTranslation } from 'react-i18next';

interface GroupProfile {
  id: string;
  name: string;
  type: string;
  contactName?: string;
  contactEmail?: string;
  status?: string;
}

interface AllotmentBlock {
  id: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  ratePlanId?: string | null;
  cutoffDate?: string | null;
  autoRelease?: boolean;
  shoulderStart?: string | null;
  shoulderEnd?: string | null;
  minLos?: number | null;
  maxLos?: number | null;
  groupCode?: string | null;
}

interface RoomingEntry {
  id: string;
  guestName: string;
  arrival?: string | null;
  departure?: string | null;
  roomTypeId?: string | null;
  reservationId?: string | null;
  status: string;
  errorNote?: string | null;
}

interface BlockFormState {
  name: string;
  startDate: string;
  endDate: string;
  cutoffDate: string;
  ratePlanId: string;
  shoulderStart: string;
  shoulderEnd: string;
  groupCode: string;
  minLos: string;
  maxLos: string;
  status: string;
}

const BLOCK_STATUSES = ['tentative', 'definite', 'released', 'cancelled'] as const;

function emptyBlockForm(): BlockFormState {
  return {
    name: '',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    endDate: format(new Date(Date.now() + 86400000 * 3), 'yyyy-MM-dd'),
    cutoffDate: '',
    ratePlanId: '',
    shoulderStart: '',
    shoulderEnd: '',
    groupCode: '',
    minLos: '',
    maxLos: '',
    status: 'tentative',
  };
}

function blockToForm(block: AllotmentBlock): BlockFormState {
  return {
    name: block.name ?? '',
    startDate: block.startDate ?? '',
    endDate: block.endDate ?? '',
    cutoffDate: block.cutoffDate ?? '',
    ratePlanId: block.ratePlanId ?? '',
    shoulderStart: block.shoulderStart ?? '',
    shoulderEnd: block.shoulderEnd ?? '',
    groupCode: block.groupCode ?? '',
    minLos: block.minLos != null ? String(block.minLos) : '',
    maxLos: block.maxLos != null ? String(block.maxLos) : '',
    status: block.status ?? 'tentative',
  };
}

/** Build create/update payload from form fields already supported by the API. */
function blockPayload(form: BlockFormState, propertyId: string, groupProfileId?: string) {
  const payload: Record<string, unknown> = {
    propertyId,
    name: form.name,
    startDate: form.startDate,
    endDate: form.endDate,
    status: form.status,
  };
  if (groupProfileId) payload.groupProfileId = groupProfileId;
  if (form.cutoffDate) payload.cutoffDate = form.cutoffDate;
  if (form.ratePlanId) payload.ratePlanId = form.ratePlanId;
  if (form.shoulderStart) payload.shoulderStart = form.shoulderStart;
  if (form.shoulderEnd) payload.shoulderEnd = form.shoulderEnd;
  if (form.groupCode) payload.groupCode = form.groupCode;
  if (form.minLos !== '') payload.minLos = Number(form.minLos);
  if (form.maxLos !== '') payload.maxLos = Number(form.maxLos);
  return payload;
}

/**
 * Parse rooming-list CSV rows.
 * Columns: guestName, arrival, departure, guestId, roomTypeId, ratePlanId, totalAmount
 * (ratePlanId may be omitted; totalAmount maps to API `totalAmount`).
 */
function parseRoomingCsv(csvText: string) {
  return csvText
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const cols = line.split(',').map((s) => s.trim());
      const [guestName, arrival, departure, guestId, roomTypeId, ratePlanId, totalAmount] = cols;
      return {
        guestName: guestName || '',
        arrival: arrival || undefined,
        departure: departure || undefined,
        guestId: guestId || undefined,
        roomTypeId: roomTypeId || undefined,
        ratePlanId: ratePlanId || undefined,
        totalAmount: totalAmount || undefined,
      };
    })
    .filter((e) => e.guestName);
}

function BlockFormFields({
  form,
  setForm,
  ratePlans,
}: {
  form: BlockFormState;
  setForm: (next: BlockFormState) => void;
  ratePlans: { id: string; name: string; code?: string }[];
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<BlockFormState>) => setForm({ ...form, ...patch });

  return (
    <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.blockName')}</label>
        <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.start')}</label>
          <input type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.end')}</label>
          <input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.cutoffDate')}</label>
        <input type="date" value={form.cutoffDate} onChange={(e) => set({ cutoffDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.shoulderStart')}</label>
          <input type="date" value={form.shoulderStart} onChange={(e) => set({ shoulderStart: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.shoulderEnd')}</label>
          <input type="date" value={form.shoulderEnd} onChange={(e) => set({ shoulderEnd: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.ratePlan')}</label>
        <select value={form.ratePlanId} onChange={(e) => set({ ratePlanId: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('groups.selectOptional')}</option>
          {ratePlans.map((rp) => (
            <option key={rp.id} value={rp.id}>{rp.name}{rp.code ? ` (${rp.code})` : ''}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.groupCode')}</label>
        <input type="text" value={form.groupCode} onChange={(e) => set({ groupCode: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.minLos')}</label>
          <input type="number" min={1} value={form.minLos} onChange={(e) => set({ minLos: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.maxLos')}</label>
          <input type="number" min={1} value={form.maxLos} onChange={(e) => set({ maxLos: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.status')}</label>
        <select value={form.status} onChange={(e) => set({ status: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
          {BLOCK_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`groups.blockStatuses.${s}`, { defaultValue: s })}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function GroupList() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('corporate');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const { data } = useQuery({
    queryKey: ['groups', propertyId],
    queryFn: () => api.get('/v1/groups/profiles', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const profiles: GroupProfile[] = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/groups/profiles', {
        propertyId,
        name,
        type,
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setCreateOpen(false);
      setName('');
    },
  });

  const processCutoffs = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/groups/blocks/process-cutoffs', null, { params: { propertyId } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups'] }),
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('groups.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <UsersRound size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('groups.title')}</h1>
        <button
          onClick={() => processCutoffs.mutate()}
          disabled={processCutoffs.isPending}
          className="ml-auto border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey disabled:opacity-50"
        >
          {t('groups.processCutoffs')}
        </button>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> {t('groups.new')}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.type')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.contact')}</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, i) => (
              <tr key={p.id} onClick={() => navigate(`/groups/${p.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{p.name}</td>
                <td className="px-4 py-3"><StatusBadge status="info" label={t(`groups.types.${p.type}`, { defaultValue: p.type })} /></td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{p.contactName ?? p.contactEmail ?? '—'}</td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('groups.noProfiles')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('groups.newProfile')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.nameRequired')}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.type')}</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="corporate">{t('groups.types.corporate')}</option>
              <option value="travel_agent">{t('groups.types.travel_agent')}</option>
              <option value="wholesale">{t('groups.types.wholesale')}</option>
              <option value="event">{t('groups.types.event')}</option>
              <option value="other">{t('groups.types.other')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.contactName')}</label>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.contactEmail')}</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{t('groups.create')}</button>
        </div>
      </Modal>
    </div>
  );
}

function GroupDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [blockOpen, setBlockOpen] = useState(false);
  const [folioOpen, setFolioOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkReservationId, setLinkReservationId] = useState('');
  const [blockForm, setBlockForm] = useState<BlockFormState>(emptyBlockForm());

  const { data } = useQuery({
    queryKey: ['groups', id, propertyId],
    queryFn: () => api.get(`/v1/groups/profiles/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const { data: blocksData } = useQuery({
    queryKey: ['groups', 'blocks', propertyId, id],
    queryFn: () => api.get('/v1/groups/blocks', { params: { propertyId, groupProfileId: id } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const { data: ratePlansData } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: folioData, refetch: refetchFolio } = useQuery({
    queryKey: ['groups', 'folio', id, propertyId],
    queryFn: () => api.get(`/v1/groups/profiles/${id}/folio`, { params: { propertyId } }).then((r) => r.data),
    enabled: false,
  });

  const profile: GroupProfile | null = data?.data ?? data ?? null;
  const blocks: AllotmentBlock[] = blocksData?.data ?? blocksData ?? [];
  const ratePlans: { id: string; name: string; code?: string }[] = ratePlansData?.data ?? ratePlansData ?? [];

  const createBlock = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/groups/blocks', {
        ...blockPayload(blockForm, propertyId, id),
        autoRelease: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', 'blocks'] });
      setBlockOpen(false);
      setBlockForm(emptyBlockForm());
    },
  });

  const linkReservation = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/groups/profiles/${id}/reservations`, {
        propertyId,
        reservationId: linkReservationId.trim(),
      });
    },
    onSuccess: () => {
      setLinkOpen(false);
      setLinkReservationId('');
    },
  });

  const generateInvoice = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/groups/profiles/${id}/invoice`, null, { params: { propertyId } });
    },
  });

  if (!profile) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;

  const folio = folioData?.data ?? folioData;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/groups')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <UsersRound size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{profile.name}</h1>
        <StatusBadge status="info" label={t(`groups.types.${profile.type}`, { defaultValue: profile.type })} />
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setLinkOpen(true)}
            className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey"
          >
            <Link2 size={14} /> {t('groups.linkReservation')}
          </button>
          <button
            onClick={async () => { await refetchFolio(); setFolioOpen(true); }}
            className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey"
          >
            <FileText size={14} /> {t('groups.masterFolio')}
          </button>
          <button
            onClick={() => generateInvoice.mutate()}
            disabled={generateInvoice.isPending}
            className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <Receipt size={14} /> {t('groups.generateInvoice')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('groups.contact')}</h2>
        <p className="text-sm text-telivity-slate">{profile.contactName ?? '—'}</p>
        <p className="text-sm text-telivity-mid-grey">{profile.contactEmail ?? ''}</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-telivity-navy">{t('groups.allotmentBlocks')}</h2>
          <button
            onClick={() => { setBlockForm(emptyBlockForm()); setBlockOpen(true); }}
            className="flex items-center gap-1 text-xs font-semibold text-telivity-teal"
          >
            <Plus size={14} /> {t('groups.newBlock')}
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.start')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.end')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b, i) => (
              <tr
                key={b.id}
                onClick={() => navigate(`/groups/${id}/blocks/${b.id}`)}
                className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}
              >
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{b.name ?? b.id.slice(0, 8)}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{b.startDate ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{b.endDate ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={b.status ?? 'pending'} label={b.status ?? '—'} /></td>
              </tr>
            ))}
            {blocks.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('groups.noBlocks')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={blockOpen} onClose={() => setBlockOpen(false)} title={t('groups.newBlock')}>
        <div className="space-y-4">
          <BlockFormFields form={blockForm} setForm={setBlockForm} ratePlans={ratePlans} />
          <button
            onClick={() => createBlock.mutate()}
            disabled={!blockForm.name || createBlock.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('groups.createBlock')}
          </button>
        </div>
      </Modal>

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title={t('groups.linkReservation')}>
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('groups.linkReservationHint')}</p>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.reservationId')}</label>
            <input
              type="text"
              value={linkReservationId}
              onChange={(e) => setLinkReservationId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          {linkReservation.isError && (
            <p className="text-xs text-red-600">{(linkReservation.error as Error)?.message ?? t('groups.linkFailed')}</p>
          )}
          {linkReservation.isSuccess && (
            <p className="text-xs text-green-700">{t('groups.linkSuccess')}</p>
          )}
          <button
            onClick={() => linkReservation.mutate()}
            disabled={!linkReservationId.trim() || linkReservation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('groups.link')}
          </button>
        </div>
      </Modal>

      <Modal open={folioOpen} onClose={() => setFolioOpen(false)} title={t('groups.masterFolio')}>
        {folio ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-telivity-mid-grey">Folio ID:</span> {folio.id ?? folio.folioId ?? '—'}</p>
            <p><span className="text-telivity-mid-grey">Balance:</span> ${Number(folio.balance ?? folio.totalBalance ?? 0).toFixed(2)}</p>
            <p><span className="text-telivity-mid-grey">Status:</span> {folio.status ?? '—'}</p>
          </div>
        ) : (
          <p className="text-sm text-telivity-mid-grey">{t('groups.noMasterFolio')}</p>
        )}
      </Modal>

      {generateInvoice.isSuccess && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
          {t('groups.invoiceGenerated')}
        </div>
      )}
    </div>
  );
}

function BlockDetail() {
  const { t } = useTranslation();
  const { id: profileId, blockId } = useParams<{ id: string; blockId: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [roomingOpen, setRoomingOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [editForm, setEditForm] = useState<BlockFormState>(emptyBlockForm());
  const [invStayDate, setInvStayDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [invRoomTypeId, setInvRoomTypeId] = useState('');
  const [invRoomsAllotted, setInvRoomsAllotted] = useState('1');

  const { data: blockData } = useQuery({
    queryKey: ['groups', 'block', blockId, propertyId],
    queryFn: () => api.get(`/v1/groups/blocks/${blockId}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!blockId && !!propertyId,
  });

  const { data: pickupData } = useQuery({
    queryKey: ['groups', 'pickup', blockId, propertyId],
    queryFn: () => api.get(`/v1/groups/blocks/${blockId}/pickup`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!blockId && !!propertyId,
  });

  const { data: roomingData } = useQuery({
    queryKey: ['groups', 'rooming', blockId, propertyId],
    queryFn: () => api.get(`/v1/groups/blocks/${blockId}/rooming-list`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!blockId && !!propertyId,
  });

  const { data: roomTypesData } = useQuery({
    queryKey: ['room-types', propertyId],
    queryFn: () => api.get('/v1/room-types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: ratePlansData } = useQuery({
    queryKey: ['rate-plans', propertyId],
    queryFn: () => api.get('/v1/rate-plans', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const block: AllotmentBlock | null = blockData?.data ?? blockData ?? null;
  const pickup = pickupData?.data ?? pickupData;
  const detail: { stayDate: string; roomTypeId?: string; roomsAllotted: number; roomsPickedUp: number; remaining: number; pickupRate: number }[] =
    pickup?.detail ?? [];
  const roomingEntries: RoomingEntry[] = Array.isArray(roomingData) ? roomingData : roomingData?.data ?? [];
  const roomTypes: { id: string; name: string }[] = roomTypesData?.data ?? roomTypesData ?? [];
  const ratePlans: { id: string; name: string; code?: string }[] = ratePlansData?.data ?? ratePlansData ?? [];

  const roomTypeName = (id?: string | null) => roomTypes.find((rt) => rt.id === id)?.name ?? (id ? id.slice(0, 8) : '—');

  const releaseBlock = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/groups/blocks/${blockId}/release`, null, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      navigate(`/groups/${profileId}`);
    },
  });

  const updateBlock = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      const body = blockPayload(editForm, propertyId);
      delete body.propertyId;
      return api.patch(`/v1/groups/blocks/${blockId}`, body, { params: { propertyId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', 'block', blockId] });
      queryClient.invalidateQueries({ queryKey: ['groups', 'blocks'] });
      setEditOpen(false);
    },
  });

  const setInventory = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.put(`/v1/groups/blocks/${blockId}/inventory`, {
        propertyId,
        stayDate: invStayDate,
        roomTypeId: invRoomTypeId,
        roomsAllotted: Number(invRoomsAllotted),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', 'pickup', blockId] });
      setInventoryOpen(false);
    },
  });

  const importRoomingList = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      const entries = parseRoomingCsv(csvText);
      return api.post(`/v1/groups/blocks/${blockId}/rooming-list`, { propertyId, entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', 'pickup'] });
      queryClient.invalidateQueries({ queryKey: ['groups', 'rooming', blockId] });
      setRoomingOpen(false);
      setCsvText('');
    },
  });

  if (!block) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.loading')}</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <button onClick={() => navigate(`/groups/${profileId}`)} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <h1 className="text-2xl font-semibold text-telivity-navy">{block.name ?? t('groups.block')}</h1>
        <StatusBadge status={block.status ?? 'pending'} label={block.status ?? '—'} />
        <div className="ml-auto flex gap-2 flex-wrap">
          <button
            onClick={() => { setEditForm(blockToForm(block)); setEditOpen(true); }}
            className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey"
          >
            <Pencil size={14} /> {t('groups.editBlock')}
          </button>
          <button
            onClick={() => {
              setInvStayDate(block.startDate ?? format(new Date(), 'yyyy-MM-dd'));
              setInvRoomTypeId(roomTypes[0]?.id ?? '');
              setInvRoomsAllotted('1');
              setInventoryOpen(true);
            }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey"
          >
            {t('groups.setInventory')}
          </button>
          <button onClick={() => setRoomingOpen(true)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey">{t('groups.uploadRoomingList')}</button>
          <button
            onClick={() => releaseBlock.mutate()}
            disabled={releaseBlock.isPending || block.status === 'released'}
            className="bg-red-600 text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {t('groups.releaseBlock')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-telivity-mid-grey">{t('groups.groupCode')}</p>
          <p className="font-medium text-telivity-navy">{block.groupCode || '—'}</p>
        </div>
        <div>
          <p className="text-xs text-telivity-mid-grey">{t('groups.ratePlan')}</p>
          <p className="font-medium text-telivity-navy">
            {ratePlans.find((rp) => rp.id === block.ratePlanId)?.name ?? (block.ratePlanId ? block.ratePlanId.slice(0, 8) : '—')}
          </p>
        </div>
        <div>
          <p className="text-xs text-telivity-mid-grey">{t('groups.shoulders')}</p>
          <p className="font-medium text-telivity-navy">
            {(block.shoulderStart || '—') + ' → ' + (block.shoulderEnd || '—')}
          </p>
        </div>
        <div>
          <p className="text-xs text-telivity-mid-grey">{t('groups.los')}</p>
          <p className="font-medium text-telivity-navy">
            {block.minLos ?? '—'} / {block.maxLos ?? '—'}
          </p>
        </div>
      </div>

      {pickup?.totals && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">{t('groups.allotted')}</p>
            <p className="text-xl font-semibold">{pickup.totals.roomsAllotted}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">{t('groups.pickedUp')}</p>
            <p className="text-xl font-semibold">{pickup.totals.roomsPickedUp}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">{t('groups.remaining')}</p>
            <p className="text-xl font-semibold">{pickup.totals.remaining}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">{t('groups.pickupRate')}</p>
            <p className="text-xl font-semibold">{Math.round((pickup.totals.pickupRate ?? 0) * 100)}%</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-telivity-navy">{t('groups.pickupReport')}</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.stayDate')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.roomType')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('groups.allotted')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('groups.pickedUp')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('groups.remaining')}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('groups.rate')}</th>
            </tr>
          </thead>
          <tbody>
            {detail.map((row) => (
              <tr key={`${row.stayDate}-${row.roomTypeId ?? ''}`} className="border-b border-gray-50">
                <td className="px-4 py-3 text-sm text-telivity-slate">{row.stayDate}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{roomTypeName(row.roomTypeId)}</td>
                <td className="px-4 py-3 text-sm text-right">{row.roomsAllotted}</td>
                <td className="px-4 py-3 text-sm text-right">{row.roomsPickedUp}</td>
                <td className="px-4 py-3 text-sm text-right">{row.remaining}</td>
                <td className="px-4 py-3 text-sm text-right">{Math.round(row.pickupRate * 100)}%</td>
              </tr>
            ))}
            {detail.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('groups.noInventory')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-telivity-navy">{t('groups.roomingEntries')}</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.guestName')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.arrival')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.departure')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('groups.roomType')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {roomingEntries.map((e, i) => (
              <tr key={e.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{e.guestName}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{e.arrival ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{e.departure ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{roomTypeName(e.roomTypeId)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={e.status === 'created' ? 'success' : e.status === 'error' ? 'error' : 'pending'} label={e.status} />
                  {e.errorNote && <p className="text-xs text-red-600 mt-1">{e.errorNote}</p>}
                </td>
              </tr>
            ))}
            {roomingEntries.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('groups.noRoomingEntries')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('groups.editBlock')}>
        <div className="space-y-4">
          <BlockFormFields form={editForm} setForm={setEditForm} ratePlans={ratePlans} />
          <button
            onClick={() => updateBlock.mutate()}
            disabled={!editForm.name || updateBlock.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('groups.saveBlock')}
          </button>
        </div>
      </Modal>

      <Modal open={inventoryOpen} onClose={() => setInventoryOpen(false)} title={t('groups.setInventory')}>
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('groups.setInventoryHint')}</p>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.stayDate')}</label>
            <input type="date" value={invStayDate} onChange={(e) => setInvStayDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.roomType')}</label>
            <select value={invRoomTypeId} onChange={(e) => setInvRoomTypeId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">{t('groups.selectRequired')}</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('groups.roomsAllotted')}</label>
            <input
              type="number"
              min={0}
              value={invRoomsAllotted}
              onChange={(e) => setInvRoomsAllotted(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {setInventory.isError && (
            <p className="text-xs text-red-600">
              {(setInventory.error as { response?: { data?: { message?: string } } })?.response?.data?.message
                ?? (setInventory.error as Error)?.message
                ?? t('groups.inventoryFailed')}
            </p>
          )}
          <button
            onClick={() => setInventory.mutate()}
            disabled={!invStayDate || !invRoomTypeId || invRoomsAllotted === '' || setInventory.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('groups.saveInventory')}
          </button>
        </div>
      </Modal>

      <Modal open={roomingOpen} onClose={() => setRoomingOpen(false)} title={t('groups.importRoomingList')}>
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">{t('groups.roomingListHint')}</p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={6}
            placeholder={'Jane Doe,2026-06-01,2026-06-04,<guestId>,<roomTypeId>,<ratePlanId>,599.00'}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
          />
          <button
            onClick={() => importRoomingList.mutate()}
            disabled={!csvText.trim() || importRoomingList.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {t('groups.import')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default function Groups() {
  return (
    <Routes>
      <Route index element={<GroupList />} />
      <Route path=":id" element={<GroupDetail />} />
      <Route path=":id/blocks/:blockId" element={<BlockDetail />} />
    </Routes>
  );
}
