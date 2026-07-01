import { useState } from 'react';
import { Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, Plus, ChevronLeft, AlertTriangle, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';

interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  vipLevel?: string;
  isDnr?: boolean;
  totalStays?: number;
  lastVisit?: string;
  preferences?: Record<string, unknown>;
  notes?: string;
  createdAt?: string;
}

// ---- Guest List ----
function GuestList() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const { data } = useQuery({
    queryKey: ['guests', propertyId, searchTerm],
    queryFn: () => api.get('/v1/guests', { params: { propertyId, search: searchTerm || undefined } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const guests: Guest[] = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/guests', { firstName, lastName, email: email || undefined, phone: phone || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setCreateOpen(false);
      setFirstName(''); setLastName(''); setEmail(''); setPhone('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property to view guests</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Users size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Guests</h1>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors">
          <Plus size={16} /> New Guest
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-telivity-mid-grey" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-telivity-teal"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Phone</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">VIP</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Stays</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Last Visit</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase tracking-wider">Flags</th>
            </tr>
          </thead>
          <tbody>
            {guests.map((g, i) => (
              <tr
                key={g.id}
                className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''} hover:bg-telivity-light-grey/50 transition-colors cursor-pointer`}
                onClick={() => navigate(`/guests/${g.id}`)}
              >
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{g.firstName} {g.lastName}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.email ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.phone ?? '—'}</td>
                <td className="px-4 py-3">
                  {g.vipLevel && g.vipLevel !== 'none' ? <StatusBadge status={g.vipLevel} /> : <span className="text-sm text-telivity-mid-grey">—</span>}
                </td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.totalStays ?? 0}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{g.lastVisit ?? '—'}</td>
                <td className="px-4 py-3">
                  {g.isDnr && <StatusBadge status="error" label="DNR" />}
                </td>
              </tr>
            ))}
            {guests.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No guests found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Guest Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Guest">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">First Name *</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Last Name *</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Phone</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!firstName || !lastName || createMutation.isPending}
            className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Guest'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Guest Detail ----
function GuestDetail() {
  const { id } = useParams<{ id: string }>();
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [vipLevel, setVipLevel] = useState('none');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const { data: guestData } = useQuery({
    queryKey: ['guests', id],
    queryFn: () => api.get(`/v1/guests/${id}`, { params: { propertyId } }).then((r) => r.data),
    enabled: !!id,
  });

  const { data: stayHistory } = useQuery({
    queryKey: ['reservations', 'guest', id],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, guestId: id } }).then((r) => r.data),
    enabled: !!id && !!propertyId,
  });

  const guest: Guest | null = guestData?.data ?? guestData ?? null;
  const stays = stayHistory?.data ?? stayHistory ?? [];

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch(`/v1/guests/${id}`, { firstName, lastName, email: email || undefined, phone: phone || undefined, vipLevel }, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guests'] });
      setEditing(false);
    },
  });

  const dnrMutation = useMutation({
    mutationFn: () => api.patch(`/v1/guests/${id}`, { isDnr: !guest?.isDnr }, { params: { propertyId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guests'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/guests/${id}`, { params: { propertyId } }),
    onSuccess: () => navigate('/guests'),
  });

  function startEdit() {
    if (!guest) return;
    setFirstName(guest.firstName);
    setLastName(guest.lastName);
    setEmail(guest.email ?? '');
    setPhone(guest.phone ?? '');
    setVipLevel(guest.vipLevel ?? 'none');
    setEditing(true);
  }

  if (!guest) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/guests')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <ChevronLeft size={20} />
        </button>
        <Users size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{guest.firstName} {guest.lastName}</h1>
        {guest.vipLevel && guest.vipLevel !== 'none' && <StatusBadge status={guest.vipLevel} />}
        {guest.isDnr && <StatusBadge status="error" label="DNR" />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-telivity-navy">Profile</h2>
            {!editing && (
              <button onClick={startEdit} className="text-sm text-telivity-teal font-medium hover:underline">Edit</button>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First Name" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last Name" className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              </div>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">VIP Level</label>
                <select value={vipLevel} onChange={(e) => setVipLevel(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
                  <option value="none">None</option>
                  <option value="gold">Gold</option>
                  <option value="platinum">Platinum</option>
                  <option value="diamond">Diamond</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold">Cancel</button>
                <button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="flex-1 bg-telivity-teal text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">Save</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <DetailRow label="Email" value={guest.email ?? '—'} />
              <DetailRow label="Phone" value={guest.phone ?? '—'} />
              <DetailRow label="VIP Level" value={guest.vipLevel ?? 'none'} />
              <DetailRow label="Total Stays" value={String(guest.totalStays ?? 0)} />
            </div>
          )}
        </div>

        {/* Stay History */}
        <div className="bg-white rounded-xl shadow-sm p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">Stay History</h2>
          {(stays as { id: string; confirmationNumber: string; arrivalDate: string; departureDate: string; status: string; roomNumber?: string }[]).length > 0 ? (
            <div className="space-y-2">
              {(stays as { id: string; confirmationNumber: string; arrivalDate: string; departureDate: string; status: string; roomNumber?: string }[]).map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-telivity-navy">{s.confirmationNumber}</p>
                    <p className="text-xs text-telivity-mid-grey">{s.arrivalDate} → {s.departureDate} {s.roomNumber ? `• Room ${s.roomNumber}` : ''}</p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-telivity-mid-grey">No stay history</p>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-6 bg-white rounded-xl shadow-sm p-6 border border-telivity-orange/20">
        <h2 className="text-sm font-semibold text-telivity-navy mb-4">Actions</h2>
        <div className="flex gap-3">
          <button
            onClick={() => { if (confirm(`${guest.isDnr ? 'Remove' : 'Set'} DNR flag for ${guest.firstName} ${guest.lastName}?`)) dnrMutation.mutate(); }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${guest.isDnr ? 'bg-telivity-dark-teal text-white' : 'bg-telivity-orange text-white'}`}
          >
            <AlertTriangle size={14} />
            {guest.isDnr ? 'Remove DNR' : 'Mark DNR'}
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-2 border border-telivity-orange text-telivity-orange rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-orange/5"
          >
            <Trash2 size={14} />
            Delete Guest (GDPR)
          </button>
        </div>
      </div>

      {/* Delete Confirmation */}
      <Modal open={deleteConfirm} onClose={() => setDeleteConfirm(false)} title="Confirm Guest Deletion">
        <div className="space-y-4">
          <div className="bg-telivity-orange/10 rounded-lg p-4">
            <p className="text-sm text-telivity-orange font-medium">This action is irreversible.</p>
            <p className="text-sm text-telivity-slate mt-1">
              All personal data for <strong>{guest.firstName} {guest.lastName}</strong> will be permanently deleted in accordance with GDPR right to erasure.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setDeleteConfirm(false)} className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm font-semibold">Cancel</button>
            <button
              onClick={() => { if (confirm('Are you absolutely sure? This cannot be undone.')) deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="flex-1 bg-telivity-orange text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Permanently Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs text-telivity-mid-grey">{label}</span>
      <span className="text-sm text-telivity-navy">{value}</span>
    </div>
  );
}

// ---- Router ----
export default function Guests() {
  return (
    <Routes>
      <Route index element={<GuestList />} />
      <Route path=":id" element={<GuestDetail />} />
    </Routes>
  );
}
