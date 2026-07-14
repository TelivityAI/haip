import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Percent, DollarSign, TrendingUp, Building2, Star } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format, subDays } from 'date-fns';
import { api } from '../lib/api';
import { formatOccupancyPercent } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import KpiCard from '../components/ui/KpiCard';

type ReportType = 'financial-summary' | 'occupancy' | 'daily-revenue' | 'occupancy-trend';

const REPORT_OPTIONS: { value: ReportType; label: string }[] = [
  { value: 'financial-summary', label: 'Financial Summary' },
  { value: 'occupancy', label: 'Occupancy' },
  { value: 'daily-revenue', label: 'Daily Revenue' },
  { value: 'occupancy-trend', label: 'Occupancy Trend' },
];

const DEMO_FAVORITES_KEY = 'haip.reportFavorites';

export default function Reports() {
  const { propertyId, isPortfolioMode, properties } = useProperty();
  const queryClient = useQueryClient();
  const [report, setReport] = useState<ReportType>('financial-summary');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data: prefsData } = useQuery({
    queryKey: ['me', 'preferences'],
    queryFn: () =>
      api.get('/v1/admin/me/preferences').then((r) => r.data?.data ?? r.data ?? {}),
  });

  const favorites: ReportType[] = useMemo(() => {
    const fromApi = (prefsData?.reportFavorites ?? []) as ReportType[];
    if (fromApi.length) return fromApi.filter((f) => REPORT_OPTIONS.some((o) => o.value === f));
    try {
      const raw = localStorage.getItem(DEMO_FAVORITES_KEY);
      if (raw) return JSON.parse(raw) as ReportType[];
    } catch {
      /* ignore */
    }
    return [];
  }, [prefsData]);

  const saveFavorites = useMutation({
    mutationFn: (next: ReportType[]) =>
      api.patch('/v1/admin/me/preferences', { reportFavorites: next }).then((r) => r.data),
    onSuccess: (_data, next) => {
      try {
        localStorage.setItem(DEMO_FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      queryClient.invalidateQueries({ queryKey: ['me', 'preferences'] });
    },
  });

  function toggleFavorite(type: ReportType) {
    const next = favorites.includes(type)
      ? favorites.filter((f) => f !== type)
      : [...favorites, type];
    saveFavorites.mutate(next);
  }

  const orderedOptions = useMemo(() => {
    const favSet = new Set(favorites);
    return [
      ...REPORT_OPTIONS.filter((o) => favSet.has(o.value)),
      ...REPORT_OPTIONS.filter((o) => !favSet.has(o.value)),
    ];
  }, [favorites]);

  useEffect(() => {
    if (favorites.length && !favorites.includes(report) && favorites[0]) {
      // Keep current selection; do not force-switch.
    }
  }, [favorites, report]);

  const portfolioReport =
    isPortfolioMode && (report === 'financial-summary' || report === 'occupancy');

  const { data } = useQuery({
    queryKey: ['reports', portfolioReport ? 'portfolio' : report, propertyId, report === 'occupancy-trend' ? startDate : date, report === 'occupancy-trend' ? endDate : null],
    queryFn: () => {
      if (portfolioReport) {
        const path =
          report === 'financial-summary'
            ? '/v1/reports/portfolio/financial-summary'
            : '/v1/reports/portfolio/occupancy';
        return api.get(path, { params: { date } }).then((r) => r.data);
      }
      const params: Record<string, string> = { propertyId: propertyId! };
      if (report === 'occupancy-trend') {
        params.startDate = startDate;
        params.endDate = endDate;
      } else {
        params.date = date;
      }
      return api.get(`/v1/reports/${report}`, { params }).then((r) => r.data);
    },
    enabled: !!propertyId && (!isPortfolioMode || portfolioReport),
  });

  const reportData = data?.data ?? data ?? {};
  const kpis = reportData.kpis ?? {};
  const revenue = reportData.revenue ?? {};
  const payments = reportData.payments ?? {};
  const propertyNameMap = new Map(properties.map((p) => [p.id, p.name]));

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  if (isPortfolioMode && !portfolioReport) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-telivity-mid-grey gap-2">
        <Building2 size={32} className="text-telivity-teal/50" />
        <p>Daily revenue and occupancy trend are per-property reports.</p>
        <p className="text-sm">Select a single property to run this report.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">
          {isPortfolioMode ? 'Portfolio Reports' : 'Reports'}
        </h1>
      </div>

      {favorites.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {favorites.map((f) => {
            const opt = REPORT_OPTIONS.find((o) => o.value === f);
            if (!opt) return null;
            return (
              <button
                key={f}
                onClick={() => setReport(f)}
                className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${
                  report === f
                    ? 'border-telivity-teal text-telivity-teal bg-telivity-teal/5'
                    : 'border-gray-200 text-telivity-slate hover:border-telivity-teal'
                }`}
              >
                <Star size={10} className="inline mr-1 fill-telivity-teal text-telivity-teal" />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Report Selector + Date */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Report</label>
          <div className="flex items-center gap-2">
            <select value={report} onChange={(e) => setReport(e.target.value as ReportType)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              {orderedOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => toggleFavorite(report)}
              className="p-2 rounded-lg border border-gray-200 hover:border-telivity-teal"
              title={favorites.includes(report) ? 'Remove favorite' : 'Add favorite'}
              aria-label={favorites.includes(report) ? 'Remove favorite' : 'Add favorite'}
            >
              <Star
                size={16}
                className={favorites.includes(report) ? 'fill-telivity-teal text-telivity-teal' : 'text-telivity-mid-grey'}
              />
            </button>
          </div>
        </div>
        {report !== 'occupancy-trend' ? (
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
          </>
        )}
      </div>

      {/* Financial Summary */}
      {report === 'financial-summary' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard title="ADR" value={kpis.adr != null ? `$${Number(kpis.adr).toFixed(2)}` : '—'} icon={DollarSign} />
            <KpiCard title="RevPAR" value={kpis.revpar != null ? `$${Number(kpis.revpar).toFixed(2)}` : '—'} icon={TrendingUp} />
            <KpiCard title="Occupancy" value={formatOccupancyPercent(kpis.occupancyRate)} icon={Percent} />
          </div>
          {isPortfolioMode && Array.isArray(reportData.byProperty) && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-telivity-navy mb-3">By Property</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                      <th className="pb-2 font-medium">Property</th>
                      <th className="pb-2 font-medium">Revenue</th>
                      <th className="pb-2 font-medium">Occupancy</th>
                      <th className="pb-2 font-medium">ADR</th>
                      <th className="pb-2 font-medium">RevPAR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reportData.byProperty as Array<{ propertyId: string; totalRevenue: number; occupancyRate: number; adr: number; revpar: number }>).map((row) => (
                      <tr key={row.propertyId} className="border-b border-gray-50">
                        <td className="py-2">{propertyNameMap.get(row.propertyId) ?? row.propertyId}</td>
                        <td className="py-2">${Number(row.totalRevenue).toFixed(2)}</td>
                        <td className="py-2">{formatOccupancyPercent(row.occupancyRate)}</td>
                        <td className="py-2">${Number(row.adr).toFixed(2)}</td>
                        <td className="py-2">${Number(row.revpar).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!isPortfolioMode && reportData.revenueByType && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-telivity-navy mb-3">Revenue Breakdown</h3>
              <div className="space-y-2">
                {Object.entries(reportData.revenueByType as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 border-b border-gray-50">
                    <span className="text-sm text-telivity-slate capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-sm font-medium">${Number(v).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Occupancy */}
      {report === 'occupancy' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard title="Occupied" value={reportData.occupiedRooms ?? 0} icon={Percent} />
            <KpiCard title="Available" value={reportData.availableRooms ?? 0} icon={Percent} />
            {!isPortfolioMode && (
              <KpiCard title="OOO" value={reportData.outOfOrder ?? 0} icon={Percent} />
            )}
            {isPortfolioMode && (
              <KpiCard title="Arrivals" value={reportData.arrivals ?? 0} icon={Percent} />
            )}
            <KpiCard title="Occupancy %" value={formatOccupancyPercent(reportData.occupancyRate)} icon={Percent} />
          </div>
          {isPortfolioMode && Array.isArray(reportData.byProperty) && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-telivity-navy mb-3">By Property</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                      <th className="pb-2 font-medium">Property</th>
                      <th className="pb-2 font-medium">Occupied</th>
                      <th className="pb-2 font-medium">Available</th>
                      <th className="pb-2 font-medium">Occupancy</th>
                      <th className="pb-2 font-medium">Arrivals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reportData.byProperty as Array<{ propertyId: string; occupiedRooms: number; availableRooms: number; occupancyRate: number; arrivals: number }>).map((row) => (
                      <tr key={row.propertyId} className="border-b border-gray-50">
                        <td className="py-2">{propertyNameMap.get(row.propertyId) ?? row.propertyId}</td>
                        <td className="py-2">{row.occupiedRooms}</td>
                        <td className="py-2">{row.availableRooms}</td>
                        <td className="py-2">{formatOccupancyPercent(row.occupancyRate)}</td>
                        <td className="py-2">{row.arrivals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Daily Revenue */}
      {report === 'daily-revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard title="Room Revenue" value={revenue.room != null ? `$${Number(revenue.room).toFixed(2)}` : '—'} icon={DollarSign} />
            <KpiCard title="Other Revenue" value={revenue.other != null ? `$${Number(revenue.other).toFixed(2)}` : '—'} icon={DollarSign} />
            <KpiCard title="Total Revenue" value={revenue.total != null ? `$${Number(revenue.total).toFixed(2)}` : '—'} icon={DollarSign} />
          </div>
          {payments && Object.keys(payments).length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-telivity-navy mb-3">Revenue by Payment Method</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={Object.entries(payments as Record<string, number>).filter(([k]) => k !== 'total').map(([k, v]) => ({ method: k, amount: v }))}>
                  <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="method" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip />
                  <Bar dataKey="amount" fill="#06bdb4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Occupancy Trend */}
      {report === 'occupancy-trend' && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-telivity-navy mb-3">Occupancy Trend</h3>
          {Array.isArray(reportData.daily) && reportData.daily.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={(reportData.daily as { date: string; occupancyRate: number }[]).map((d) => ({
                ...d,
                occupancyPct: Number(d.occupancyRate) * 100,
              }))}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 12 }} domain={[0, 100]} /><Tooltip />
                <Line type="monotone" dataKey="occupancyPct" stroke="#06bdb4" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-telivity-mid-grey">No trend data available</p>
          )}
        </div>
      )}
    </div>
  );
}
