import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UsersRound, Plus, ChevronLeft, FileText, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { requirePropertyId } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

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
}

function GroupList() {
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
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <UsersRound size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Groups</h1>
        <button
          onClick={() => processCutoffs.mutate()}
          disabled={processCutoffs.isPending}
          className="ml-auto border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-grey disabled:opacity-50"
        >
          Process Cutoffs
        </button>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> New Group
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Contact</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p, i) => (
              <tr key={p.id} onClick={() => navigate(`/groups/${p.id}`)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{p.name}</td>
                <td className="px-4 py-3"><StatusBadge status="info" label={p.type} /></td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{p.contactName ?? p.contactEmail ?? '—'}</td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No group profiles</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Group Profile">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="corporate">Corporate</option>
              <option value="travel_agent">Travel Agent</option>
              <option value="wholesale">Wholesale</option>
              <option value="event">Event</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Contact Name</label>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Contact Email</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Create</button>
        </div>
      </Modal>
    </div>
  );
}

function GroupDetail() {
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [blockOpen, setBlockOpen] = useState(false);
  const [folioOpen, setFolioOpen] = useState(false);
  const [blockName, setBlockName] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(Date.now() + 86400000 * 3), 'yyyy-MM-dd'));
  const [cutoffDate, setCutoffDate] = useState('');

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

  const { data: folioData, refetch: refetchFolio } = useQuery({
    queryKey: ['groups', 'folio', id, propertyId],
    queryFn: () => api.get(`/v1/groups/profiles/${id}/folio`, { params: { propertyId } }).then((r) => r.data),
    enabled: false,
  });

  const profile: GroupProfile | null = data?.data ?? data ?? null;
  const blocks: AllotmentBlock[] = blocksData?.data ?? blocksData ?? [];

  const createBlock = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post('/v1/groups/blocks', {
        propertyId,
        groupProfileId: id,
        name: blockName,
        startDate,
        endDate,
        cutoffDate: cutoffDate || undefined,
        autoRelease: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', 'blocks'] });
      setBlockOpen(false);
      setBlockName('');
    },
  });

  const generateInvoice = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      return api.post(`/v1/groups/profiles/${id}/invoice`, null, { params: { propertyId } });
    },
  });

  if (!profile) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Loading...</div>;

  const folio = folioData?.data ?? folioData;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/groups')} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <UsersRound size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{profile.name}</h1>
        <StatusBadge status="info" label={profile.type} />
        <div className="ml-auto flex gap-2">
          <button
            onClick={async () => { await refetchFolio(); setFolioOpen(true); }}
            className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey"
          >
            <FileText size={14} /> Master Folio
          </button>
          <button
            onClick={() => generateInvoice.mutate()}
            disabled={generateInvoice.isPending}
            className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            <Receipt size={14} /> Generate Invoice
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
        <h2 className="text-sm font-semibold text-telivity-navy mb-3">Contact</h2>
        <p className="text-sm text-telivity-slate">{profile.contactName ?? '—'}</p>
        <p className="text-sm text-telivity-mid-grey">{profile.contactEmail ?? ''}</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-telivity-navy">Allotment Blocks</h2>
          <button onClick={() => setBlockOpen(true)} className="flex items-center gap-1 text-xs font-semibold text-telivity-teal"><Plus size={14} /> New Block</button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Start</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">End</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
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
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No blocks</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={blockOpen} onClose={() => setBlockOpen(false)} title="New Allotment Block">
        <div className="space-y-4">
          <input type="text" value={blockName} onChange={(e) => setBlockName(e.target.value)} placeholder="Block name *" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <input type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} placeholder="Cutoff date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={() => createBlock.mutate()} disabled={!blockName || createBlock.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Create Block</button>
        </div>
      </Modal>

      <Modal open={folioOpen} onClose={() => setFolioOpen(false)} title="Master Folio">
        {folio ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-telivity-mid-grey">Folio ID:</span> {folio.id ?? folio.folioId ?? '—'}</p>
            <p><span className="text-telivity-mid-grey">Balance:</span> ${Number(folio.balance ?? folio.totalBalance ?? 0).toFixed(2)}</p>
            <p><span className="text-telivity-mid-grey">Status:</span> {folio.status ?? '—'}</p>
          </div>
        ) : (
          <p className="text-sm text-telivity-mid-grey">No master folio found for this group.</p>
        )}
      </Modal>

      {generateInvoice.isSuccess && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
          Invoice generated successfully.
        </div>
      )}
    </div>
  );
}

function BlockDetail() {
  const { id: profileId, blockId } = useParams<{ id: string; blockId: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [roomingOpen, setRoomingOpen] = useState(false);
  const [csvText, setCsvText] = useState('');

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

  const block: AllotmentBlock | null = blockData?.data ?? blockData ?? null;
  const pickup = pickupData?.data ?? pickupData;
  const detail: { stayDate: string; roomsAllotted: number; roomsPickedUp: number; remaining: number; pickupRate: number }[] = pickup?.detail ?? [];

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

  const importRoomingList = useMutation({
    mutationFn: () => {
      requirePropertyId(propertyId);
      const lines = csvText.trim().split('\n').filter(Boolean);
      const entries = lines.map((line) => {
        const [guestName, arrival, departure, guestId] = line.split(',').map((s) => s.trim());
        return {
          guestName,
          arrival: arrival || undefined,
          departure: departure || undefined,
          guestId: guestId || undefined,
        };
      });
      return api.post(`/v1/groups/blocks/${blockId}/rooming-list`, { propertyId, entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups', 'pickup'] });
      setRoomingOpen(false);
      setCsvText('');
    },
  });

  if (!block) return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Loading...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(`/groups/${profileId}`)} className="p-1.5 rounded hover:bg-telivity-light-grey"><ChevronLeft size={20} /></button>
        <h1 className="text-2xl font-semibold text-telivity-navy">{block.name ?? 'Block'}</h1>
        <StatusBadge status={block.status ?? 'pending'} label={block.status ?? '—'} />
        <div className="ml-auto flex gap-2">
          <button onClick={() => setRoomingOpen(true)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-grey">Upload Rooming List</button>
          <button
            onClick={() => releaseBlock.mutate()}
            disabled={releaseBlock.isPending || block.status === 'released'}
            className="bg-red-600 text-white rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            Release Block
          </button>
        </div>
      </div>

      {pickup?.totals && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">Allotted</p>
            <p className="text-xl font-semibold">{pickup.totals.roomsAllotted}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">Picked Up</p>
            <p className="text-xl font-semibold">{pickup.totals.roomsPickedUp}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">Remaining</p>
            <p className="text-xl font-semibold">{pickup.totals.remaining}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4 text-center">
            <p className="text-xs text-telivity-mid-grey">Pickup Rate</p>
            <p className="text-xl font-semibold">{Math.round((pickup.totals.pickupRate ?? 0) * 100)}%</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-telivity-navy">Pickup Report</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Stay Date</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Allotted</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Picked Up</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Remaining</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">Rate</th>
            </tr>
          </thead>
          <tbody>
            {detail.map((row) => (
              <tr key={row.stayDate} className="border-b border-gray-50">
                <td className="px-4 py-3 text-sm text-telivity-slate">{row.stayDate}</td>
                <td className="px-4 py-3 text-sm text-right">{row.roomsAllotted}</td>
                <td className="px-4 py-3 text-sm text-right">{row.roomsPickedUp}</td>
                <td className="px-4 py-3 text-sm text-right">{row.remaining}</td>
                <td className="px-4 py-3 text-sm text-right">{Math.round(row.pickupRate * 100)}%</td>
              </tr>
            ))}
            {detail.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No inventory rows</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={roomingOpen} onClose={() => setRoomingOpen(false)} title="Import Rooming List">
        <div className="space-y-4">
          <p className="text-xs text-telivity-mid-grey">One guest per line: name, arrival, departure, guestId (optional UUID)</p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={6}
            placeholder="Jane Doe, 2026-06-01, 2026-06-04&#10;John Smith, 2026-06-01, 2026-06-03"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono"
          />
          <button onClick={() => importRoomingList.mutate()} disabled={!csvText.trim() || importRoomingList.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Import</button>
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
