import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Percent, DollarSign, TrendingUp } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { format, subDays } from 'date-fns';
import { api } from '../lib/api';
import { formatOccupancyPercent } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import KpiCard from '../components/ui/KpiCard';

type ReportType = 'financial-summary' | 'occupancy' | 'daily-revenue' | 'occupancy-trend';

const PIE_COLORS = ['#06bdb4', '#00a692', '#f2641b', '#eec517', '#bbbbc4', '#016491'];

export default function Reports() {
  const { propertyId } = useProperty();
  const [report, setReport] = useState<ReportType>('financial-summary');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { data } = useQuery({
    queryKey: ['reports', report, propertyId, report === 'occupancy-trend' ? startDate : date, report === 'occupancy-trend' ? endDate : null],
    queryFn: () => {
      const params: Record<string, string> = { propertyId: propertyId! };
      if (report === 'occupancy-trend') {
        params.startDate = startDate;
        params.endDate = endDate;
      } else {
        params.date = date;
      }
      return api.get(`/v1/reports/${report}`, { params }).then((r) => r.data);
    },
    enabled: !!propertyId,
  });

  const reportData = data?.data ?? data ?? {};
  const kpis = reportData.kpis ?? {};
  const revenue = reportData.revenue ?? {};
  const payments = reportData.payments ?? {};

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">Select a property</div>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">Reports</h1>
      </div>

      {/* Report Selector + Date */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">Report</label>
          <select value={report} onChange={(e) => setReport(e.target.value as ReportType)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
            <option value="financial-summary">Financial Summary</option>
            <option value="occupancy">Occupancy</option>
            <option value="daily-revenue">Daily Revenue</option>
            <option value="occupancy-trend">Occupancy Trend</option>
          </select>
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
          {reportData.revenueByType && (
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
            <KpiCard title="OOO" value={reportData.outOfOrder ?? 0} icon={Percent} />
            <KpiCard title="Occupancy %" value={formatOccupancyPercent(reportData.occupancyRate)} icon={Percent} />
          </div>
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
