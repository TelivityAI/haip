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
  Building2,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatOccupancyPercent } from '../lib/api-helpers';
import { getDateLocale } from '../lib/date-locale';
import { useProperty } from '../context/PropertyContext';
import { getSocket } from '../lib/socket';
import KpiCard from '../components/ui/KpiCard';
import { useTranslation } from 'react-i18next';

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

interface ActivityEvent {
  id: string;
  event: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { propertyId, setPropertyId, isPortfolioMode, properties } = useProperty();
  const navigate = useNavigate();
  const now = new Date();
  const dateLocale = getDateLocale(i18n.resolvedLanguage);
  const today = format(now, 'yyyy-MM-dd');
  const formattedToday = format(now, 'PPPP', { locale: dateLocale });

  const activeProperty = isPortfolioMode
    ? null
    : properties.find((p) => p.id === propertyId);
  const thr = activeProperty?.settings?.kpiThresholds ?? {};

  const { data: portfolioFinancial } = useQuery({
    queryKey: ['reports', 'portfolio', 'financial-summary', today],
    queryFn: () => api.get('/v1/reports/portfolio/financial-summary', { params: { date: today } }).then((r) => r.data),
    enabled: isPortfolioMode,
  });

  const { data: portfolioOccupancy } = useQuery({
    queryKey: ['reports', 'portfolio', 'occupancy', today],
    queryFn: () => api.get('/v1/reports/portfolio/occupancy', { params: { date: today } }).then((r) => r.data),
    enabled: isPortfolioMode,
  });

  const { data: financial } = useQuery({
    queryKey: ['reports', 'financial-summary', propertyId, today],
    queryFn: () => api.get('/v1/reports/financial-summary', { params: { propertyId, date: today } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: occupancy } = useQuery({
    queryKey: ['reports', 'occupancy', propertyId, today],
    queryFn: () => api.get('/v1/reports/occupancy', { params: { propertyId, date: today } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: roomSummary } = useQuery({
    queryKey: ['rooms', 'status-summary', propertyId],
    queryFn: () => api.get('/v1/rooms/status-summary', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: arrivals } = useQuery({
    queryKey: ['reservations', 'arrivals', propertyId, today],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'confirmed', arrivalDateFrom: today, arrivalDateTo: today } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: departures } = useQuery({
    queryKey: ['reservations', 'departures', propertyId, today],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'checked_in', departureDateFrom: today, departureDateTo: today } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: inHouse } = useQuery({
    queryKey: ['reservations', 'in-house', propertyId],
    queryFn: () => api.get('/v1/reservations', { params: { propertyId, status: 'checked_in' } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: agentStatuses } = useQuery({
    queryKey: ['agents', propertyId],
    queryFn: () => api.get(`/v1/agents/${propertyId}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const [activities, setActivities] = useState<ActivityEvent[]>([]);

  const handleEvent = useCallback((payload: ActivityEvent) => {
    setActivities((prev) => [payload, ...prev].slice(0, 10));
  }, []);

  useEffect(() => {
    if (isPortfolioMode) return;
    const socket = getSocket();
    socket.on('pmsEvent', handleEvent);
    return () => { socket.off('pmsEvent', handleEvent); };
  }, [handleEvent, isPortfolioMode]);

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('dashboard.selectProperty')}
      </div>
    );
  }

  // Portfolio mode dashboard
  if (isPortfolioMode) {
    const fin = portfolioFinancial?.data ?? portfolioFinancial ?? {};
    const occ = portfolioOccupancy?.data ?? portfolioOccupancy ?? {};
    const kpis = fin.kpis ?? {};
    const byProperty = fin.byProperty ?? [];
    const propertyNameMap = new Map(properties.map((p) => [p.id, p.name]));

    const chartData = byProperty.map((row: { propertyId: string; totalRevenue: number }) => ({
      name: propertyNameMap.get(row.propertyId) ?? row.propertyId.slice(0, 8),
      revenue: row.totalRevenue,
    }));

    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Building2 size={24} className="text-telivity-teal" />
          <h1 className="text-2xl font-semibold text-telivity-navy">{t('dashboard.portfolio.title')}</h1>
          <span className="text-sm text-telivity-mid-grey ml-auto">
            {t('dashboard.portfolio.propertyCount', { count: fin.propertyCount ?? properties.length })} · {formattedToday}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            title={t('dashboard.portfolio.occupancy')}
            value={formatOccupancyPercent(kpis.occupancyRate)}
            subtitle={t('dashboard.occupiedOfRooms', { occupied: occ.occupiedRooms ?? 0, total: occ.availableRooms ?? 0 })}
            icon={Percent}
          />
          <KpiCard
            title={t('dashboard.portfolio.adr')}
            value={kpis.adr != null ? `$${Number(kpis.adr).toFixed(2)}` : '—'}
            subtitle={t('dashboard.portfolio.weightedAverage')}
            icon={DollarSign}
          />
          <KpiCard
            title={t('dashboard.portfolio.revpar')}
            value={kpis.revpar != null ? `$${Number(kpis.revpar).toFixed(2)}` : '—'}
            subtitle={t('dashboard.portfolio.acrossAllProperties')}
            icon={TrendingUp}
          />
          <KpiCard
            title={t('dashboard.portfolio.totalRevenueToday')}
            value={kpis.totalRevenue != null ? `$${Number(kpis.totalRevenue).toFixed(2)}` : '—'}
            subtitle={t('dashboard.portfolio.arrivalsAndDepartures', { arrivals: occ.arrivals ?? 0, departures: occ.departures ?? 0 })}
            icon={BedDouble}
          />
        </div>

        {chartData.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
            <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('dashboard.portfolio.revenueByProperty')}</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, t('dashboard.portfolio.revenue')]} />
                <Bar dataKey="revenue" fill="#06bdb4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('dashboard.portfolio.propertyBreakdown')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                  <th className="pb-2 font-medium">{t('dashboard.portfolio.property')}</th>
                  <th className="pb-2 font-medium">{t('dashboard.occupancy')}</th>
                  <th className="pb-2 font-medium">{t('dashboard.adr')}</th>
                  <th className="pb-2 font-medium">{t('dashboard.revpar')}</th>
                  <th className="pb-2 font-medium">{t('dashboard.portfolio.revenue')}</th>
                </tr>
              </thead>
              <tbody>
                {byProperty.map((row: { propertyId: string; occupancyRate: number; adr: number; revpar: number; totalRevenue: number }) => (
                  <tr key={row.propertyId} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 font-medium text-telivity-navy">
                      <button
                        className="hover:text-telivity-teal"
                        onClick={() => setPropertyId(row.propertyId)}
                      >
                        {propertyNameMap.get(row.propertyId) ?? row.propertyId}
                      </button>
                    </td>
                    <td className="py-2.5">{formatOccupancyPercent(row.occupancyRate)}</td>
                    <td className="py-2.5">${Number(row.adr).toFixed(2)}</td>
                    <td className="py-2.5">${Number(row.revpar).toFixed(2)}</td>
                    <td className="py-2.5">${Number(row.totalRevenue).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  const occ = occupancy?.data ?? occupancy ?? {};
  const fin = financial?.data ?? financial ?? {};
  const kpis = fin.kpis ?? {};
  const arrList = arrivals?.data ?? arrivals ?? [];
  const depList = departures?.data ?? departures ?? [];
  const ihList = inHouse?.data ?? inHouse ?? [];

  const roomData = roomSummary?.data ?? roomSummary ?? [];
  const chartData = Array.isArray(roomData)
    ? roomData.map((r: { status: string; count: number }) => ({
        name: t(`dashboard.roomStatuses.${r.status}`, { defaultValue: r.status.replace(/_/g, ' ') }),
        status: r.status,
        value: Number(r.count),
        color: ROOM_STATUS_COLORS[r.status] ?? '#bbbbc4',
      }))
    : [];

  const totalRooms = chartData.reduce((sum: number, d: { value: number }) => sum + d.value, 0);
  const occupiedCount = chartData.find((d: { status: string }) => d.status === 'occupied')?.value ?? 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('nav.dashboard')}</h1>
        <span className="text-sm text-telivity-mid-grey ml-auto">{formattedToday}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          title={t('dashboard.occupancy')}
          value={formatOccupancyPercent(occ.occupancyRate)}
          subtitle={t('dashboard.occupiedOfRooms', {
            occupied: occ.occupiedRooms ?? occupiedCount,
            total: occ.availableRooms ?? totalRooms,
          })}
          icon={Percent}
          numericValue={occ.occupancyRate != null ? Number(occ.occupancyRate) : undefined}
          threshold={thr.occupancyRate}
        />
        <KpiCard
          title={t('dashboard.adr')}
          value={kpis.adr != null ? `$${Number(kpis.adr).toFixed(2)}` : '—'}
          subtitle={t('dashboard.averageDailyRate')}
          icon={DollarSign}
          numericValue={kpis.adr != null ? Number(kpis.adr) : undefined}
          threshold={thr.adr}
        />
        <KpiCard
          title={t('dashboard.revpar')}
          value={kpis.revpar != null ? `$${Number(kpis.revpar).toFixed(2)}` : '—'}
          subtitle={t('dashboard.revenuePerAvailableRoom')}
          icon={TrendingUp}
          numericValue={kpis.revpar != null ? Number(kpis.revpar) : undefined}
          threshold={thr.revpar}
        />
        <KpiCard
          title={t('dashboard.revenueToday')}
          value={kpis.totalRevenue != null ? `$${Number(kpis.totalRevenue).toFixed(2)}` : '—'}
          subtitle={t('dashboard.revenueBreakdown')}
          icon={BedDouble}
          numericValue={kpis.totalRevenue != null ? Number(kpis.totalRevenue) : undefined}
          threshold={thr.totalRevenue}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">Today's Activity</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-teal/10 rounded-lg">
                <LogIn size={16} className="text-telivity-teal" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{Array.isArray(arrList) ? arrList.length : 0}</p>
                <p className="text-xs text-telivity-mid-grey">{t('dashboard.arrivals')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-deep-blue/10 rounded-lg">
                <Users size={16} className="text-telivity-deep-blue" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{Array.isArray(ihList) ? ihList.length : 0}</p>
                <p className="text-xs text-telivity-mid-grey">{t('dashboard.inHouse')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-orange/10 rounded-lg">
                <LogOut size={16} className="text-telivity-orange" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{Array.isArray(depList) ? depList.length : 0}</p>
                <p className="text-xs text-telivity-mid-grey">{t('dashboard.departures')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-telivity-dark-teal/10 rounded-lg">
                <DoorOpen size={16} className="text-telivity-dark-teal" />
              </div>
              <div>
                <p className="text-sm font-medium text-telivity-navy">{totalRooms - occupiedCount}</p>
                <p className="text-xs text-telivity-mid-grey">{t('dashboard.availableRooms')}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('dashboard.roomStatus')}</h2>
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
              <h2 className="text-sm font-semibold text-telivity-navy">{t('dashboard.revenueIntelligence')}</h2>
              <p className="text-xs text-telivity-mid-grey mt-0.5">
                {t('dashboard.activeAgents', { count: agentStatuses.filter((a: { isEnabled: boolean }) => a.isEnabled).length })}
                {' | '}
                {t('dashboard.pendingDecisions', { count: agentStatuses.reduce((s: number, a: { pendingDecisions?: number }) => s + (a.pendingDecisions ?? 0), 0) })}
              </p>
            </div>
            <span className="text-xs text-telivity-teal font-medium">{t('dashboard.viewRevenueManagement')} &rarr;</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('dashboard.recentActivityLive')}</h2>
        {activities.length > 0 ? (
          <div className="space-y-2">
            {activities.map((a, i) => (
              <div key={`${a.timestamp}-${i}`} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="w-2 h-2 rounded-full bg-telivity-teal flex-shrink-0" />
                <span className="text-sm font-medium text-telivity-navy">{a.event}</span>
                <span className="text-xs text-telivity-mid-grey ml-auto">
                  {format(new Date(a.timestamp), 'pp', { locale: dateLocale })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-telivity-mid-grey">{t('dashboard.waitingForEvents')}</p>
        )}
      </div>
    </div>
  );
}
