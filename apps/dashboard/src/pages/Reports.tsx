import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Percent, DollarSign, TrendingUp, Building2, Star } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format, subDays } from 'date-fns';
import { api } from '../lib/api';
import { formatOccupancyPercent } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import KpiCard from '../components/ui/KpiCard';
import { useTranslation } from 'react-i18next';

type ReportType = 'financial-summary' | 'occupancy' | 'daily-revenue' | 'occupancy-trend' | 'trial-balance' | 'pickup';

const REPORT_OPTIONS: { value: ReportType; labelKey: string }[] = [
  { value: 'financial-summary', labelKey: 'financialSummary' },
  { value: 'occupancy', labelKey: 'occupancy' },
  { value: 'daily-revenue', labelKey: 'dailyRevenue' },
  { value: 'trial-balance', labelKey: 'trialBalance' },
  { value: 'occupancy-trend', labelKey: 'occupancyTrend' },
  { value: 'pickup', labelKey: 'pickup' },
];

const DEMO_FAVORITES_KEY = 'haip.reportFavorites';

export default function Reports() {
  const { t } = useTranslation();
  const { propertyId, isPortfolioMode, properties } = useProperty();
  const queryClient = useQueryClient();
  const [report, setReport] = useState<ReportType>('financial-summary');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [stayDate, setStayDate] = useState(format(subDays(new Date(), -30), 'yyyy-MM-dd'));
  const [pickupFrom, setPickupFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [pickupTo, setPickupTo] = useState(format(new Date(), 'yyyy-MM-dd'));

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
    queryKey: ['reports', portfolioReport ? 'portfolio' : report, propertyId, report === 'occupancy-trend' ? startDate : report === 'pickup' ? stayDate : date, report === 'occupancy-trend' ? endDate : report === 'pickup' ? pickupTo : null, report === 'pickup' ? pickupFrom : null],
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
      } else if (report === 'pickup') {
        params.stayDate = stayDate;
        params.from = pickupFrom;
        params.to = pickupTo;
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
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('reports.selectProperty')}</div>;
  }

  if (isPortfolioMode && !portfolioReport) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-telivity-mid-grey gap-2">
        <Building2 size={32} className="text-telivity-teal/50" />
        <p>{t('reports.portfolioNotice')}</p>
        <p className="text-sm">{t('reports.selectSingleProperty')}</p>
      </div>
    );
  }

  type LedgerRow = {
    opening: string;
    netActivity: string;
    transfersIn: string;
    transfersOut: string;
    closing: string;
  };
  const ledgers = (reportData.ledgers ?? {}) as Record<string, LedgerRow>;
  const ledgerOrder: { key: string; labelKey: string }[] = [
    { key: 'deposit', labelKey: 'trialBalanceDeposit' },
    { key: 'guest', labelKey: 'trialBalanceGuest' },
    { key: 'ar', labelKey: 'trialBalanceAr' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">
          {isPortfolioMode ? t('reports.portfolioTitle') : t('reports.title')}
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
                {t(`reports.${opt.labelKey}`)}
              </button>
            );
          })}
        </div>
      )}

      {/* Report Selector + Date */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.report')}</label>
          <div className="flex items-center gap-2">
            <select value={report} onChange={(e) => setReport(e.target.value as ReportType)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal">
              {orderedOptions.map((o) => (
                <option key={o.value} value={o.value}>{t(`reports.${o.labelKey}`)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => toggleFavorite(report)}
              className="p-2 rounded-lg border border-gray-200 hover:border-telivity-teal"
              title={favorites.includes(report) ? t('reports.removeFavorite') : t('reports.addFavorite')}
              aria-label={favorites.includes(report) ? t('reports.removeFavorite') : t('reports.addFavorite')}
            >
              <Star
                size={16}
                className={favorites.includes(report) ? 'fill-telivity-teal text-telivity-teal' : 'text-telivity-mid-grey'}
              />
            </button>
          </div>
        </div>
        {report !== 'occupancy-trend' && report !== 'pickup' ? (
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.date')}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
        ) : report === 'occupancy-trend' ? (
          <>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.from')}</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.to')}</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.stayDate')}</label>
              <input type="date" value={stayDate} onChange={(e) => setStayDate(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.from')}</label>
              <input type="date" value={pickupFrom} onChange={(e) => setPickupFrom(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.to')}</label>
              <input type="date" value={pickupTo} onChange={(e) => setPickupTo(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
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
              <h3 className="text-sm font-semibold text-telivity-navy mb-3">{t('reports.byProperty')}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                      <th className="pb-2 font-medium">{t('reports.property')}</th>
                      <th className="pb-2 font-medium">{t('reports.revenue')}</th>
                      <th className="pb-2 font-medium">{t('reports.occupancy')}</th>
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
              <h3 className="text-sm font-semibold text-telivity-navy mb-3">{t('reports.revenueBreakdown')}</h3>
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
            <KpiCard title={t('reports.occupied')} value={reportData.occupiedRooms ?? 0} icon={Percent} />
            <KpiCard title={t('reports.available')} value={reportData.availableRooms ?? 0} icon={Percent} />
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
          <h3 className="text-sm font-semibold text-telivity-navy mb-3">{t('reports.occupancyTrend')}</h3>
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
            <p className="text-sm text-telivity-mid-grey">{t('reports.noTrend')}</p>
          )}
        </div>
      )}

      {/* Trial Balance */}
      {report === 'trial-balance' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold text-telivity-navy mb-3">{t('reports.trialBalance')}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                  <th className="pb-2 font-medium">{t('reports.trialBalanceLedger')}</th>
                  <th className="pb-2 font-medium text-right">{t('reports.trialBalanceOpening')}</th>
                  <th className="pb-2 font-medium text-right">{t('reports.trialBalanceNetActivity')}</th>
                  <th className="pb-2 font-medium text-right">{t('reports.trialBalanceTransfersIn')}</th>
                  <th className="pb-2 font-medium text-right">{t('reports.trialBalanceTransfersOut')}</th>
                  <th className="pb-2 font-medium text-right">{t('reports.trialBalanceClosing')}</th>
                </tr>
              </thead>
              <tbody>
                {ledgerOrder.map(({ key, labelKey }) => {
                  const row = ledgers[key];
                  if (!row) return null;
                  return (
                    <tr key={key} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-telivity-navy">{t(`reports.${labelKey}`)}</td>
                      <td className="py-2 text-right">${Number(row.opening).toFixed(2)}</td>
                      <td className="py-2 text-right">${Number(row.netActivity).toFixed(2)}</td>
                      <td className="py-2 text-right">${Number(row.transfersIn).toFixed(2)}</td>
                      <td className="py-2 text-right">${Number(row.transfersOut).toFixed(2)}</td>
                      <td className="py-2 text-right font-medium">${Number(row.closing).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {reportData.interLedgerTransfers != null && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex justify-between text-sm">
                <span className="text-telivity-slate">{t('reports.trialBalanceInterLedger')}</span>
                <span className="font-medium text-telivity-navy">${Number(reportData.interLedgerTransfers).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pickup */}
      {report === 'pickup' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard title={t('reports.baselineRoomNights')} value={reportData.baseline?.roomNights ?? 0} icon={TrendingUp} />
            <KpiCard title={t('reports.currentRoomNights')} value={reportData.current?.roomNights ?? 0} icon={TrendingUp} />
            <KpiCard
              title={t('reports.netPickup')}
              value={reportData.pickup?.roomNights ?? 0}
              icon={TrendingUp}
            />
          </div>
          {Array.isArray(reportData.daily) && reportData.daily.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-5 overflow-x-auto">
              <h3 className="text-sm font-semibold text-telivity-navy mb-3">{t('reports.dailyPickup')}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                    <th className="pb-2 font-medium">{t('reports.date')}</th>
                    <th className="pb-2 font-medium text-right">{t('reports.added')}</th>
                    <th className="pb-2 font-medium text-right">{t('reports.lost')}</th>
                    <th className="pb-2 font-medium text-right">{t('reports.netPickup')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(reportData.daily as Array<{ date: string; roomNightsAdded: number; roomNightsLost: number; netPickup: number }>).map((row) => (
                    <tr key={row.date} className="border-b border-gray-50">
                      <td className="py-2">{row.date}</td>
                      <td className="py-2 text-right text-green-700">+{row.roomNightsAdded}</td>
                      <td className="py-2 text-right text-red-600">-{row.roomNightsLost}</td>
                      <td className="py-2 text-right font-medium">{row.netPickup >= 0 ? `+${row.netPickup}` : row.netPickup}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-telivity-mid-grey">{t('reports.noPickup')}</p>
          )}
        </div>
      )}
    </div>
  );
}
