import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Percent,
  DollarSign,
  TrendingUp,
  BedDouble,
  LogIn,
  LogOut,
  Users,
  DoorOpen,
  Brain,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatOccupancyPercent } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import { getSocket } from '../lib/socket';
import KpiCard from '../components/ui/KpiCard';

const ROOM_STATUS_COLORS: Record<string, string> = {
  occupied: '#06bdb4',
  vacant_clean: '#00a692',
  vacant_dirty: '#f2641b',
  out_of_order: '#eec517',
  out_of_service: '#bbbbc4',
  clean: '#00a692',
  inspected: '#016491',
  guest_ready: '#2cd1b9',
};

function formatLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ActivityEvent {
  id: string;
  event: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export default function Dashboard() {
  const { propertyId } = useProperty();
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: financial } = useQuery({
    queryKey: ['reports', 'financial-summary', propertyId, today],
    queryFn: () => api.get('/v1/reports/financial-summary', { params: { propertyId, date: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: occupancy } = useQuery({
    queryKey: ['reports', 'occupancy', propertyId, today],
    queryFn: () => api.get('/v1/reports/occupancy', { params: { propertyId, date: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: roomSummary } = useQuery({
    queryKey: ['rooms', 'status-summary', propertyId],
    queryFn: () => api.get('/v1/rooms/status-summary', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: arrivals } = useQuery({
    queryKey: ['reservations', 'arrivals', propertyId, today],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'confirmed', arrivalDateFrom: today, arrivalDateTo: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: departures } = useQuery({
    queryKey: ['reservations', 'departures', propertyId, today],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'checked_in', departureDateFrom: today, departureDateTo: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: inHouse } = useQuery({
    queryKey: ['reservations', 'in-house', propertyId],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'checked_in' } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: agentStatuses } = useQuery({
    queryKey: ['agents', propertyId],
    queryFn: () => api.get(`/v1/agents/${propertyId}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId,
  });

  // Real-time activity feed
  const [activities, setActivities] = useState<ActivityEvent[]>([]);

  const handleEvent = useCallback((payload: ActivityEvent) => {
    setActivities((prev) => [payload, ...prev].slice(0, 10));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socket.on('pmsEvent', handleEvent);
    return () => { socket.off('pmsEvent', handleEvent); };
  }, [handleEvent]);

  const occ = occupancy?.data ?? occupancy ?? {};
  const fin = financial?.data ?? financial ?? {};
  const kpis = fin.kpis ?? {};
  const arrList = arrivals?.data ?? arrivals ?? [];
  const depList = departures?.data ?? departures ?? [];
  const ihList = inHouse?.data ?? inHouse ?? [];

  const roomData = roomSummary?.data ?? roomSummary ?? [];
  const chartData = Array.isArray(roomData)
    ? roomData.map((r: { status: string; count: number }) => ({
        name: formatLabel(r.status),
        value: Number(r.count),
        color: ROOM_STATUS_COLORS[r.status] ?? '#bbbbc4',
      }))
    : [];

  const totalRooms = chartData.reduce((sum: number, d: { value: number }) => sum + d.value, 0);
  const occupiedCount = chartData.find((d: { name: string }) => d.name === 'Occupied')?.value ?? 0;

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        Select a property to view the dashboard
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Dashboard</h1>
        <span className="text-sm text-telivity-mid-grey ml-auto">{format(new Date(), 'EEEE, MMMM d, yyyy')}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          title="Occupancy"
          value={formatOccupancyPercent(occ.occupancyRate)}
          subtitle={`${occ.occupiedRooms ?? occupiedCount} of ${occ.availableRooms ?? totalRooms} rooms`}
          icon={Percent}
        />
        <KpiCard
          title="ADR"
          value={kpis.adr != null ? `$${Number(kpis.adr).toFixed(2)}` : '—'}
          subtitle="Average Daily Rate"
          icon={DollarSign}
        />
        <KpiCard
          title="RevPAR"
          value={kpis.revpar != null ? `$${Number(kpis.revpar).toFixed(2)}` : '—'}
          subtitle="Revenue per Available Room"
          icon={TrendingUp}
        />
        <KpiCard
          title="Revenue Today"
          value={kpis.totalRevenue != null ? `$${Number(kpis.totalRevenue).toFixed(2)}` : '—'}
          subtitle="Room + F&B + Other"
          icon={BedDouble}
        />
      </div>

      {/* Today's Activity + Room Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Today's Activity */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">Today's Activity</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-teal/10 rounded-lg">
                <LogIn size={16} className="text-telivity-teal" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{Array.isArray(arrList) ? arrList.length : 0}</p>
                <p className="text-xs text-telivity-mid-grey">Arrivals</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-deep-blue/10 rounded-lg">
                <Users size={16} className="text-telivity-deep-blue" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{Array.isArray(ihList) ? ihList.length : 0}</p>
                <p className="text-xs text-telivity-mid-grey">In-House</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-orange/10 rounded-lg">
                <LogOut size={16} className="text-telivity-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{Array.isArray(depList) ? depList.length : 0}</p>
                <p className="text-xs text-telivity-mid-grey">Departures</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-dark-teal/10 rounded-lg">
                <DoorOpen size={16} className="text-telivity-dark-teal" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{totalRooms - occupiedCount}</p>
                <p className="text-xs text-telivity-mid-grey">Available Rooms</p>
              </div>
            </div>
          </div>
        </div>

        {/* Room Status Donut */}
        <div className="bg-white rounded-xl shadow-sm p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">Room Status</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={95}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={2}
                >
                  {chartData.map((entry: { name: string; color: string }, i: number) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60 text-telivity-mid-grey text-sm">
              No room data available
            </div>
          )}
        </div>
      </div>

      {/* Revenue Intelligence Card */}
      {Array.isArray(agentStatuses) && agentStatuses.length > 0 && (
        <div
          className="bg-white rounded-xl shadow-sm p-5 mb-6 cursor-pointer hover:ring-2 hover:ring-telivity-teal/30 transition-all"
          onClick={() => navigate('/revenue')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-telivity-teal/10 rounded-lg">
              <Brain size={20} className="text-telivity-teal" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-telivity-navy">Revenue Intelligence</h2>
              <p className="text-xs text-telivity-mid-grey mt-0.5">
                {agentStatuses.filter((a: any) => a.isEnabled).length} agents active
                {' | '}
                {agentStatuses.reduce((s: number, a: any) => s + (a.pendingDecisions ?? 0), 0)} pending decisions
              </p>
            </div>
            <span className="text-xs text-telivity-teal font-medium">View Revenue Management &rarr;</span>
          </div>
        </div>
      )}

      {/* Recent Activity Feed */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-telivity-navy mb-4">Recent Activity (Live)</h2>
        {activities.length > 0 ? (
          <div className="space-y-2">
            {activities.map((a, i) => (
              <div key={`${a.timestamp}-${i}`} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="w-2 h-2 rounded-full bg-telivity-teal flex-shrink-0" />
                <span className="text-sm font-medium text-telivity-navy">{a.event}</span>
                <span className="text-xs text-telivity-mid-grey ml-auto">
                  {format(new Date(a.timestamp), 'HH:mm:ss')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-telivity-mid-grey">Waiting for real-time events...</p>
        )}
      </div>
    </div>
  );
}
