import { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, LayoutGrid, List, Plus, X, Image as ImageIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { useMediaList } from '../hooks/useMedia';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import MediaGallery from '../components/media/MediaGallery';

interface Room {
  id: string;
  number: string;
  roomTypeId: string;
  roomTypeName?: string;
  floor?: string;
  building?: string;
  status: string;
  guestName?: string;
  isAccessible?: boolean;
  amenities?: string[];
}

interface RoomType {
  id: string;
  name: string;
  code: string;
  maxOccupancy?: number;
  bedType?: string;
  roomCount?: number;
}

interface StatusCount {
  status: string;
  count: number;
}

const STATUS_CARD_COLORS: Record<string, string> = {
  occupied: 'border-telivity-teal bg-telivity-teal/5',
  vacant_clean: 'border-telivity-dark-teal bg-telivity-dark-teal/5',
  vacant_dirty: 'border-telivity-orange bg-telivity-orange/5',
  clean: 'border-telivity-dark-teal bg-telivity-dark-teal/5',
  inspected: 'border-telivity-deep-blue bg-telivity-deep-blue/5',
  guest_ready: 'border-telivity-dark-teal bg-telivity-dark-teal/5',
  out_of_order: 'border-telivity-yellow bg-telivity-yellow/5',
  out_of_service: 'border-telivity-mid-grey bg-gray-50',
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  vacant_dirty: ['clean'],
  clean: ['inspected', 'out_of_order', 'out_of_service'],
  inspected: ['guest_ready', 'out_of_order'],
  guest_ready: ['occupied', 'out_of_order', 'out_of_service'],
  occupied: ['vacant_dirty'],
  out_of_order: ['vacant_dirty'],
  out_of_service: ['vacant_dirty'],
};

// ---- Room Detail Slide-Over ----
function RoomDetailPanel({
  room,
  propertyId,
  onClose,
  onTransition,
  transitioning,
}: {
  room: Room;
  propertyId: string;
  onClose: () => void;
  onTransition: (newStatus: string) => void;
  transitioning: boolean;
}) {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Mirror each backend route's authorization so we never show controls that
  // would 403: PATCH /rooms/:id allows admin/front_desk/housekeeping_manager,
  // but every media route is admin-only. In the demo (auth off) hasRole
  // returns true so admins see all editing controls.
  const canManageAmenities = hasRole('admin', 'front_desk', 'housekeeping_manager');
  const canManagePhotos = hasRole('admin');

  // Main photo: the room's own primary, falling back to the room type's primary
  // (rooms usually inherit their type's photos rather than having their own).
  const { data: roomMedia = [] } = useMediaList(propertyId, 'room', room.id);
  const { data: typeMedia = [] } = useMediaList(propertyId, 'room_type', room.roomTypeId);
  const primaryImage =
    roomMedia.find((m) => m.isPrimary) ?? roomMedia[0] ??
    typeMedia.find((m) => m.isPrimary) ?? typeMedia[0] ?? null;

  const [amenities, setAmenities] = useState<string[]>(room.amenities ?? []);
  const [newAmenity, setNewAmenity] = useState('');
  const [photosOpen, setPhotosOpen] = useState(false);
  const dirty = JSON.stringify(amenities) !== JSON.stringify(room.amenities ?? []);

  const saveAmenities = useMutation({
    mutationFn: () => api.patch(`/v1/rooms/${room.id}`, { amenities }, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast('success', 'Features updated');
    },
    onError: () => toast('error', 'Failed to update features'),
  });

  const addAmenity = () => {
    const v = newAmenity.trim().toLowerCase().replace(/\s+/g, '_');
    if (v && !amenities.includes(v)) setAmenities([...amenities, v]);
    setNewAmenity('');
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-telivity-navy">Room {room.number}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-telivity-light-grey"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-5">
          {/* Main photo */}
          <div className="relative">
            {primaryImage ? (
              <img
                src={primaryImage.url}
                alt={primaryImage.altText ?? `Room ${room.number}`}
                className="w-full h-40 object-cover rounded-xl border border-gray-100"
              />
            ) : (
              <div className="w-full h-40 rounded-xl border border-dashed border-gray-200 bg-telivity-light-grey/40 flex flex-col items-center justify-center text-telivity-mid-grey">
                <ImageIcon size={28} />
                <span className="text-xs mt-1">No photo</span>
              </div>
            )}
            {canManagePhotos && (
              <button
                onClick={() => setPhotosOpen(true)}
                className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-white/90 backdrop-blur text-telivity-slate text-xs font-medium rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-white"
              >
                <ImageIcon size={13} /> Manage photos
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <StatusBadge status={room.status} />
            {room.isAccessible && <StatusBadge status="info" label="ADA" />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-telivity-mid-grey">Type</p><p className="text-sm font-medium">{room.roomTypeName ?? '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">Floor</p><p className="text-sm font-medium">{room.floor ?? '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">Building</p><p className="text-sm font-medium">{room.building ?? '—'}</p></div>
            <div><p className="text-xs text-telivity-mid-grey">Guest</p><p className="text-sm font-medium">{room.guestName ?? 'None'}</p></div>
          </div>

          {/* Status Transitions */}
          <div>
            <p className="text-xs font-medium text-telivity-mid-grey mb-2">Change Status</p>
            <div className="flex flex-wrap gap-2">
              {(VALID_TRANSITIONS[room.status] ?? []).map((s) => (
                <button
                  key={s}
                  onClick={() => onTransition(s)}
                  disabled={transitioning}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium hover:border-telivity-teal hover:bg-telivity-teal/5 transition-colors disabled:opacity-50"
                >
                  → {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Features / amenities */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-telivity-mid-grey">Features</p>
              {canManageAmenities && dirty && (
                <button
                  onClick={() => saveAmenities.mutate()}
                  disabled={saveAmenities.isPending}
                  className="text-xs font-semibold text-telivity-teal hover:text-telivity-light-teal disabled:opacity-50"
                >
                  {saveAmenities.isPending ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {amenities.map((f) => (
                <span key={f} className="inline-flex items-center gap-1 bg-telivity-light-grey text-telivity-slate text-xs rounded-lg px-2 py-1">
                  {f}
                  {canManageAmenities && (
                    <button onClick={() => setAmenities(amenities.filter((a) => a !== f))} className="text-telivity-mid-grey hover:text-telivity-orange" aria-label={`Remove ${f}`}>
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
              {amenities.length === 0 && <span className="text-xs text-telivity-mid-grey">No features</span>}
            </div>
            {canManageAmenities && (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={newAmenity}
                  onChange={(e) => setNewAmenity(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAmenity(); } }}
                  placeholder="Add a feature…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-telivity-teal"
                />
                <button onClick={addAmenity} disabled={!newAmenity.trim()} className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium hover:border-telivity-teal disabled:opacity-50">Add</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {canManagePhotos && (
        <Modal open={photosOpen} onClose={() => setPhotosOpen(false)} title={`Photos — Room ${room.number}`}>
          <MediaGallery propertyId={propertyId} ownerType="room" ownerId={room.id} canManage={canManagePhotos} />
        </Modal>
      )}
    </div>
  );
}

// ---- Room List / Rack ----
function RoomList() {
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'rack' | 'list'>('rack');
  const [detailRoom, setDetailRoom] = useState<Room | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomType, setNewRoomType] = useState('');
  const [newFloor, setNewFloor] = useState('1');

  const { data: roomsData } = useQuery({
    queryKey: ['rooms', propertyId],
    queryFn: () => api.get('/v1/rooms', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: summaryData } = useQuery({
    queryKey: ['rooms', 'status-summary', propertyId],
    queryFn: () => api.get('/v1/rooms/status-summary', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: typesData } = useQuery({
    queryKey: ['rooms', 'types', propertyId],
    queryFn: () => api.get('/v1/rooms/types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const rooms: Room[] = roomsData?.data ?? roomsData ?? [];
  const summary: StatusCount[] = summaryData?.data ?? summaryData ?? [];
  const types: RoomType[] = typesData?.data ?? typesData ?? [];

  const statusMutation = useMutation({
    mutationFn: ({ roomId, newStatus }: { roomId: string; newStatus: string }) =>
      api.patch(`/v1/rooms/${roomId}/status`, { newStatus }, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      setDetailRoom(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/rooms', { propertyId, number: newRoomNumber, roomTypeId: newRoomType, floor: newFloor }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      setCreateOpen(false);
      setNewRoomNumber('');
    },
  });

  // Group rooms by floor for rack view
  const roomsByFloor = rooms.reduce<Record<string, Room[]>>((acc, r) => {
    const floor = r.floor ?? '1';
    (acc[floor] ??= []).push(r);
    return acc;
  }, {});

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property to view rooms</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <DoorOpen size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Rooms</h1>
        <div className="ml-auto flex gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            <button onClick={() => setView('rack')} className={`p-2 ${view === 'rack' ? 'bg-telivity-teal text-white' : 'hover:bg-telivity-light-grey'}`}><LayoutGrid size={16} /></button>
            <button onClick={() => setView('list')} className={`p-2 ${view === 'list' ? 'bg-telivity-teal text-white' : 'hover:bg-telivity-light-grey'}`}><List size={16} /></button>
          </div>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal transition-colors">
            <Plus size={16} /> Add Room
          </button>
        </div>
      </div>

      {/* Status Summary */}
      <div className="flex flex-wrap gap-2 mb-4">
        {summary.map((s) => (
          <div key={s.status} className="bg-white rounded-lg shadow-sm px-3 py-2 flex items-center gap-2">
            <StatusBadge status={s.status} />
            <span className="text-sm font-semibold text-telivity-navy">{s.count}</span>
          </div>
        ))}
      </div>

      {/* Rack View */}
      {view === 'rack' && (
        <div className="space-y-6">
          {Object.entries(roomsByFloor).sort(([a], [b]) => Number(a) - Number(b)).map(([floor, floorRooms]) => (
            <div key={floor}>
              <h3 className="text-xs font-semibold text-telivity-mid-grey uppercase tracking-wider mb-2">Floor {floor}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {floorRooms.sort((a, b) => a.number.localeCompare(b.number)).map((room) => (
                  <div
                    key={room.id}
                    onClick={() => setDetailRoom(room)}
                    className={`border-2 rounded-xl p-3 cursor-pointer transition-all hover:shadow-md ${STATUS_CARD_COLORS[room.status] ?? 'border-gray-200'}`}
                  >
                    <p className="text-sm font-semibold text-telivity-navy">{room.number}</p>
                    <p className="text-[10px] text-telivity-mid-grey truncate">{room.roomTypeName ?? ''}</p>
                    <StatusBadge status={room.status} className="mt-1.5 text-[9px] px-1.5 py-0" />
                    {room.guestName && (
                      <p className="text-[10px] text-telivity-slate mt-1 truncate">{room.guestName}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {rooms.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center text-telivity-mid-grey">No rooms found</div>
          )}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Room #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Floor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Guest</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">ADA</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r, i) => (
                <tr key={r.id} onClick={() => setDetailRoom(r)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{r.number}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{r.roomTypeName ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{r.floor ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{r.guestName ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">{r.isAccessible ? 'Yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Room Detail Slide-Over */}
      {detailRoom && (
        <RoomDetailPanel
          key={detailRoom.id}
          room={detailRoom}
          propertyId={propertyId}
          onClose={() => setDetailRoom(null)}
          onTransition={(s) => statusMutation.mutate({ roomId: detailRoom.id, newStatus: s })}
          transitioning={statusMutation.isPending}
        />
      )}

      {/* Create Room Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add Room">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Room Number *</label>
            <input type="text" value={newRoomNumber} onChange={(e) => setNewRoomNumber(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Room Type *</label>
            <select value={newRoomType} onChange={(e) => setNewRoomType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="">Select type</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Floor</label>
            <input type="number" value={newFloor} onChange={(e) => setNewFloor(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!newRoomNumber || !newRoomType || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {createMutation.isPending ? 'Creating...' : 'Create Room'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Room Types ----
function RoomTypeList() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [maxOcc, setMaxOcc] = useState(2);
  const [bedType, setBedType] = useState('king');
  const [photoType, setPhotoType] = useState<RoomType | null>(null);

  const { data } = useQuery({
    queryKey: ['rooms', 'types', propertyId],
    queryFn: () => api.get('/v1/rooms/types', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const types: RoomType[] = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () => api.post('/v1/rooms/types', { propertyId, name, code, maxOccupancy: maxOcc, bedType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', 'types'] });
      setCreateOpen(false);
      setName(''); setCode('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/rooms')} className="p-1.5 rounded hover:bg-telivity-light-grey">
          <DoorOpen size={20} />
        </button>
        <h1 className="text-2xl font-semibold text-telivity-navy">Room Types</h1>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> New Type
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Code</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Max Occupancy</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Bed Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Rooms</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">Photos</th>
            </tr>
          </thead>
          <tbody>
            {types.map((t, i) => (
              <tr key={t.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{t.name}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{t.code}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{t.maxOccupancy ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{t.bedType ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{t.roomCount ?? '—'}</td>
                <td className="px-4 py-3 text-sm">
                  <button onClick={() => setPhotoType(t)} className="flex items-center gap-1.5 text-telivity-teal hover:text-telivity-light-teal font-medium">
                    <ImageIcon size={14} /> Manage
                  </button>
                </td>
              </tr>
            ))}
            {types.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">No room types</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {photoType && propertyId && (
        <Modal open={!!photoType} onClose={() => setPhotoType(null)} title={`Photos — ${photoType.name}`}>
          <MediaGallery propertyId={propertyId} ownerType="room_type" ownerId={photoType.id} />
        </Modal>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Room Type">
        <div className="space-y-4">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Name *</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Code *</label><input type="text" value={code} onChange={(e) => setCode(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">Max Occupancy</label><input type="number" min={1} value={maxOcc} onChange={(e) => setMaxOcc(Number(e.target.value))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Bed Type</label>
            <select value={bedType} onChange={(e) => setBedType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              <option value="king">King</option><option value="queen">Queen</option><option value="double">Double</option><option value="twin">Twin</option><option value="suite">Suite</option>
            </select>
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!name || !code || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Create</button>
        </div>
      </Modal>
    </div>
  );
}

export default function Rooms() {
  return (
    <Routes>
      <Route index element={<RoomList />} />
      <Route path="types" element={<RoomTypeList />} />
    </Routes>
  );
}
