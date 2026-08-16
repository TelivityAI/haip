import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Percent,
  DollarSign,
  TrendingUp,
  Building2,
  BookOpen,
  CalendarRange,
  LineChart as LineChartIcon,
  Scale,
  Download,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { api } from '../lib/api';
import { formatOccupancyPercent } from '../lib/api-helpers';
import { useProperty } from '../context/PropertyContext';
import BiKpiCard from '../components/bi/BiKpiCard';
import BiPanel from '../components/bi/BiPanel';
import BiHero from '../components/bi/BiHero';
import ReportGallery, { type ReportGalleryItem } from '../components/bi/ReportGallery';
import {
  OccupancyTrendChart,
  PaymentMethodBars,
  PaceDualLineChart,
  RevenueMixBars,
} from '../components/bi/BiCharts';
import { formatMoney } from '../lib/money';
import { useTranslation } from 'react-i18next';

type ReportType =
  | 'financial-summary'
  | 'occupancy'
  | 'daily-revenue'
  | 'occupancy-trend'
  | 'trial-balance'
  | 'pickup'
  | 'booking-pace';

const DEMO_FAVORITES_KEY = 'haip.reportFavorites';

const REPORT_META: {
  value: ReportType;
  labelKey: string;
  descKey: string;
  categoryKey: string;
  icon: ReportGalleryItem['icon'];
  portfolioOk?: boolean;
}[] = [
  {
    value: 'financial-summary',
    labelKey: 'financialSummary',
    descKey: 'descFinancialSummary',
    categoryKey: 'catFlash',
    icon: DollarSign,
    portfolioOk: true,
  },
  {
    value: 'occupancy',
    labelKey: 'occupancy',
    descKey: 'descOccupancy',
    categoryKey: 'catRooms',
    icon: Percent,
    portfolioOk: true,
  },
  {
    value: 'daily-revenue',
    labelKey: 'dailyRevenue',
    descKey: 'descDailyRevenue',
    categoryKey: 'catFlash',
    icon: BarChart3,
  },
  {
    value: 'trial-balance',
    labelKey: 'trialBalance',
    descKey: 'descTrialBalance',
    categoryKey: 'catAccounting',
    icon: Scale,
  },
  {
    value: 'occupancy-trend',
    labelKey: 'occupancyTrend',
    descKey: 'descOccupancyTrend',
    categoryKey: 'catDemand',
    icon: LineChartIcon,
  },
  {
    value: 'pickup',
    labelKey: 'pickup',
    descKey: 'descPickup',
    categoryKey: 'catDemand',
    icon: TrendingUp,
  },
  {
    value: 'booking-pace',
    labelKey: 'bookingPace',
    descKey: 'descBookingPace',
    categoryKey: 'catDemand',
    icon: CalendarRange,
  },
];

export default function Reports() {
  const { t } = useTranslation();
  const { propertyId, isPortfolioMode, properties, currencyCode } = useProperty();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedReport = searchParams.get('report') as ReportType | null;
  const linkedDate = searchParams.get('date');
  const [report, setReport] = useState<ReportType | null>(
    linkedReport && REPORT_META.some((o) => o.value === linkedReport)
      ? linkedReport
      : null,
  );
  const [date, setDate] = useState(linkedDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [stayDate, setStayDate] = useState(format(subDays(new Date(), -30), 'yyyy-MM-dd'));
  const [pickupFrom, setPickupFrom] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [pickupTo, setPickupTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const money = (n: number | string) => formatMoney(n, currencyCode);

  const { data: prefsData } = useQuery({
    queryKey: ['me', 'preferences'],
    queryFn: () =>
      api.get('/v1/admin/me/preferences').then((r) => r.data?.data ?? r.data ?? {}),
  });

  const favorites: ReportType[] = useMemo(() => {
    const fromApi = (prefsData?.reportFavorites ?? []) as ReportType[];
    if (fromApi.length) return fromApi.filter((f) => REPORT_META.some((o) => o.value === f));
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

  function selectReport(id: string) {
    const next = id as ReportType;
    setReport(next);
    const params = new URLSearchParams(searchParams);
    params.set('report', next);
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    if (linkedReport && REPORT_META.some((o) => o.value === linkedReport)) {
      setReport(linkedReport);
    }
  }, [linkedReport]);

  const galleryItems: ReportGalleryItem[] = useMemo(() => {
    const favSet = new Set(favorites);
    const ordered = [
      ...REPORT_META.filter((o) => favSet.has(o.value)),
      ...REPORT_META.filter((o) => !favSet.has(o.value)),
    ];
    return ordered.map((o) => ({
      id: o.value,
      title: t(`reports.${o.labelKey}`),
      description: t(`reports.${o.descKey}`),
      category: t(`reports.${o.categoryKey}`),
      icon: o.icon,
      favorite: favSet.has(o.value),
      portfolioOk: o.portfolioOk,
    }));
  }, [favorites, t]);

  const portfolioReport =
    !!report &&
    isPortfolioMode &&
    (report === 'financial-summary' || report === 'occupancy');

  const usesDateRange = report === 'occupancy-trend' || report === 'booking-pace';

  const { data, isFetching } = useQuery({
    queryKey: [
      'reports',
      portfolioReport ? 'portfolio' : report,
      propertyId,
      usesDateRange ? startDate : report === 'pickup' ? stayDate : date,
      usesDateRange ? endDate : report === 'pickup' ? pickupTo : null,
      report === 'pickup' ? pickupFrom : null,
    ],
    queryFn: () => {
      if (portfolioReport) {
        const path =
          report === 'financial-summary'
            ? '/v1/reports/portfolio/financial-summary'
            : '/v1/reports/portfolio/occupancy';
        return api.get(path, { params: { date } }).then((r) => r.data);
      }
      const params: Record<string, string> = { propertyId: propertyId! };
      if (usesDateRange) {
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
    enabled: !!propertyId && !!report && (!isPortfolioMode || portfolioReport),
  });

  const reportData = data?.data ?? data ?? {};
  const kpis = reportData.kpis ?? {};
  const revenue = reportData.revenue ?? {};
  const payments = reportData.payments ?? {};
  const propertyNameMap = new Map(properties.map((p) => [p.id, p.name]));

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

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('reports.selectProperty')}
      </div>
    );
  }

  const activeMeta = REPORT_META.find((o) => o.value === report);

  return (
    <div>
      <BiHero
        eyebrow={t('reports.biEyebrow')}
        title={isPortfolioMode ? t('reports.portfolioTitle') : t('reports.title')}
        subtitle={t('reports.biSubtitle')}
        dateLabel={
          report
            ? t(`reports.${activeMeta?.labelKey ?? 'title'}`)
            : t('reports.pickReport')
        }
        icon={BookOpen}
      />

      <ReportGallery
        items={galleryItems}
        activeId={report}
        onSelect={selectReport}
        onToggleFavorite={(id) => toggleFavorite(id as ReportType)}
        favoriteLabel={t('reports.addFavorite')}
        unfavoriteLabel={t('reports.removeFavorite')}
      />

      {!report && (
        <div className="rounded-2xl border border-dashed border-telivity-mid-grey/40 bg-white/60 px-6 py-16 text-center">
          <BarChart3 className="mx-auto text-telivity-teal mb-3" size={28} />
          <p className="text-sm font-semibold text-telivity-navy">{t('reports.pickReport')}</p>
          <p className="text-xs text-telivity-mid-grey mt-1 max-w-md mx-auto">
            {t('reports.pickReportHint')}
          </p>
        </div>
      )}

      {report && isPortfolioMode && !portfolioReport && (
        <div className="flex flex-col items-center justify-center py-16 text-telivity-mid-grey gap-2 bg-white rounded-2xl shadow-sm">
          <Building2 size={32} className="text-telivity-teal/50" />
          <p>{t('reports.portfolioNotice')}</p>
          <p className="text-sm">{t('reports.selectSingleProperty')}</p>
        </div>
      )}

      {report && (!isPortfolioMode || portfolioReport) && (
        <>
          <div className="bg-white rounded-2xl shadow-sm border border-black/[0.03] p-4 mb-4 flex flex-wrap gap-3 items-end">
            {report !== 'occupancy-trend' && report !== 'booking-pace' && report !== 'pickup' ? (
              <div>
                <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                  {t('reports.date')}
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                />
              </div>
            ) : usesDateRange ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                    {t('reports.from')}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                    {t('reports.to')}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                    {t('reports.stayDate')}
                  </label>
                  <input
                    type="date"
                    value={stayDate}
                    onChange={(e) => setStayDate(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                    {t('reports.from')}
                  </label>
                  <input
                    type="date"
                    value={pickupFrom}
                    onChange={(e) => setPickupFrom(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
                    {t('reports.to')}
                  </label>
                  <input
                    type="date"
                    value={pickupTo}
                    onChange={(e) => setPickupTo(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
                  />
                </div>
              </>
            )}
            {(report === 'daily-revenue' || report === 'trial-balance') && !isPortfolioMode && (
              <a
                href={`/api/v1/accounting-export/${
                  report === 'daily-revenue' ? 'revenue-journal' : 'trial-balance'
                }.csv?propertyId=${propertyId}&date=${date}`}
                className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-telivity-navy text-white hover:bg-telivity-slate"
              >
                <Download size={13} />
                {t('reports.exportCsv')}
              </a>
            )}
            {isFetching && (
              <span className="text-xs text-telivity-mid-grey ml-auto animate-pulse">
                {t('reports.loading')}
              </span>
            )}
          </div>

          {report === 'financial-summary' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <BiKpiCard
                  title={t('dashboard.adr')}
                  value={kpis.adr != null ? money(kpis.adr) : '—'}
                  icon={DollarSign}
                />
                <BiKpiCard
                  title={t('dashboard.revpar')}
                  value={kpis.revpar != null ? money(kpis.revpar) : '—'}
                  icon={TrendingUp}
                />
                <BiKpiCard
                  title={t('dashboard.occupancy')}
                  value={formatOccupancyPercent(kpis.occupancyRate)}
                  icon={Percent}
                />
                <BiKpiCard
                  title={t('reports.totalRevenue')}
                  value={kpis.totalRevenue != null ? money(kpis.totalRevenue) : '—'}
                  icon={BarChart3}
                />
              </div>
              {!isPortfolioMode && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <BiPanel title={t('reports.revenueBreakdown')} icon={DollarSign}>
                    <RevenueMixBars
                      data={Object.entries(
                        (reportData.revenueByType ?? {}) as Record<string, number>,
                      ).map(([k, v]) => ({ name: k.replace(/_/g, ' '), amount: Number(v) }))}
                      currencyFmt={(n) => money(n)}
                      emptyLabel={t('dashboard.panels.noRevenueMix')}
                    />
                  </BiPanel>
                  <BiPanel title={t('dashboard.panels.ledgerHealth')} icon={Scale} tone="navy">
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/70">{t('dashboard.panels.openFolioBalance')}</span>
                        <span className="font-semibold text-white">
                          {money(Number(reportData.outstandingBalances?.totalBalanceDue ?? 0))}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/70">{t('dashboard.panels.openFolios', {
                          count: Number(reportData.outstandingBalances?.totalFoliosOpen ?? 0),
                        })}</span>
                      </div>
                      <div className="border-t border-white/10 pt-3 flex justify-between">
                        <span className="text-white/70">{t('dashboard.panels.lastAudit')}</span>
                        <span className="text-white">
                          {reportData.auditStatus?.lastAuditDate
                            ? `${reportData.auditStatus.lastAuditDate} · ${reportData.auditStatus.lastAuditStatus ?? '—'}`
                            : t('dashboard.panels.noAudit')}
                        </span>
                      </div>
                    </div>
                  </BiPanel>
                </div>
              )}
              {isPortfolioMode && Array.isArray(reportData.byProperty) && (
                <BiPanel title={t('reports.byProperty')} icon={Building2}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                          <th className="pb-2 font-medium">{t('reports.property')}</th>
                          <th className="pb-2 font-medium">{t('reports.revenue')}</th>
                          <th className="pb-2 font-medium">{t('reports.occupancy')}</th>
                          <th className="pb-2 font-medium">{t('dashboard.adr')}</th>
                          <th className="pb-2 font-medium">{t('dashboard.revpar')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          reportData.byProperty as Array<{
                            propertyId: string;
                            totalRevenue: number;
                            occupancyRate: number;
                            adr: number;
                            revpar: number;
                          }>
                        ).map((row) => (
                          <tr key={row.propertyId} className="border-b border-gray-50">
                            <td className="py-2">
                              {propertyNameMap.get(row.propertyId) ?? row.propertyId}
                            </td>
                            <td className="py-2">{money(row.totalRevenue)}</td>
                            <td className="py-2">{formatOccupancyPercent(row.occupancyRate)}</td>
                            <td className="py-2">{money(row.adr)}</td>
                            <td className="py-2">{money(row.revpar)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </BiPanel>
              )}
            </div>
          )}

          {report === 'occupancy' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <BiKpiCard title={t('reports.occupied')} value={reportData.occupiedRooms ?? 0} icon={Percent} />
                <BiKpiCard title={t('reports.available')} value={reportData.availableRooms ?? 0} icon={Percent} />
                {!isPortfolioMode && (
                  <BiKpiCard title={t('reports.ooo')} value={reportData.outOfOrder ?? 0} icon={Percent} />
                )}
                {isPortfolioMode && (
                  <BiKpiCard title={t('reports.arrivals')} value={reportData.arrivals ?? 0} icon={Percent} />
                )}
                <BiKpiCard
                  title={t('dashboard.occupancy')}
                  value={formatOccupancyPercent(reportData.occupancyRate)}
                  icon={Percent}
                />
              </div>
              {isPortfolioMode && Array.isArray(reportData.byProperty) && (
                <BiPanel title={t('reports.byProperty')} icon={Building2}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                          <th className="pb-2 font-medium">{t('reports.property')}</th>
                          <th className="pb-2 font-medium">{t('reports.occupied')}</th>
                          <th className="pb-2 font-medium">{t('reports.available')}</th>
                          <th className="pb-2 font-medium">{t('reports.occupancy')}</th>
                          <th className="pb-2 font-medium">{t('reports.arrivals')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          reportData.byProperty as Array<{
                            propertyId: string;
                            occupiedRooms: number;
                            availableRooms: number;
                            occupancyRate: number;
                            arrivals: number;
                          }>
                        ).map((row) => (
                          <tr key={row.propertyId} className="border-b border-gray-50">
                            <td className="py-2">
                              {propertyNameMap.get(row.propertyId) ?? row.propertyId}
                            </td>
                            <td className="py-2">{row.occupiedRooms}</td>
                            <td className="py-2">{row.availableRooms}</td>
                            <td className="py-2">{formatOccupancyPercent(row.occupancyRate)}</td>
                            <td className="py-2">{row.arrivals}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </BiPanel>
              )}
            </div>
          )}

          {report === 'daily-revenue' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <BiKpiCard
                  title={t('reports.roomRevenue')}
                  value={revenue.room != null ? money(revenue.room) : '—'}
                  icon={DollarSign}
                />
                <BiKpiCard
                  title={t('reports.otherRevenue')}
                  value={revenue.other != null ? money(revenue.other) : '—'}
                  icon={DollarSign}
                />
                <BiKpiCard
                  title={t('reports.totalRevenue')}
                  value={revenue.total != null ? money(revenue.total) : '—'}
                  icon={DollarSign}
                />
              </div>
              <BiPanel title={t('reports.revenueByPaymentMethod')} icon={BarChart3}>
                <PaymentMethodBars
                  data={Object.entries(payments as Record<string, number>)
                    .filter(([k]) => k !== 'total')
                    .map(([k, v]) => ({ method: k.replace(/_/g, ' '), amount: Number(v) }))}
                  currencyFmt={(n) => money(n)}
                  emptyLabel={t('dashboard.panels.noPayments')}
                />
              </BiPanel>
            </div>
          )}

          {report === 'occupancy-trend' && (
            <BiPanel title={t('reports.occupancyTrend')} icon={LineChartIcon}>
              <OccupancyTrendChart
                data={(
                  (reportData.daily ?? []) as { date: string; occupancyRate: number }[]
                ).map((d) => ({
                  date: d.date,
                  occupancyPct: Number(d.occupancyRate) * 100,
                }))}
                emptyLabel={t('reports.noTrend')}
                valueLabel={t('dashboard.occupancy')}
              />
            </BiPanel>
          )}

          {report === 'trial-balance' && (
            <div className="space-y-4">
              <BiPanel title={t('reports.trialBalance')} icon={Scale}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                        <th className="pb-2 font-medium">{t('reports.trialBalanceLedger')}</th>
                        <th className="pb-2 font-medium text-right">
                          {t('reports.trialBalanceOpening')}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t('reports.trialBalanceNetActivity')}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t('reports.trialBalanceTransfersIn')}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t('reports.trialBalanceTransfersOut')}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t('reports.trialBalanceClosing')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerOrder.map(({ key, labelKey }) => {
                        const row = ledgers[key];
                        if (!row) return null;
                        return (
                          <tr key={key} className="border-b border-gray-50">
                            <td className="py-2 font-medium text-telivity-navy">
                              {t(`reports.${labelKey}`)}
                            </td>
                            <td className="py-2 text-right">{money(row.opening)}</td>
                            <td className="py-2 text-right">{money(row.netActivity)}</td>
                            <td className="py-2 text-right">{money(row.transfersIn)}</td>
                            <td className="py-2 text-right">{money(row.transfersOut)}</td>
                            <td className="py-2 text-right font-medium">{money(row.closing)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </BiPanel>
              {reportData.interLedgerTransfers != null && (
                <BiPanel title={t('reports.trialBalanceInterLedger')} icon={Scale} tone="teal">
                  <p className="text-xl font-semibold text-telivity-navy tabular-nums">
                    {money(reportData.interLedgerTransfers)}
                  </p>
                </BiPanel>
              )}
            </div>
          )}

          {report === 'pickup' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <BiKpiCard
                  title={t('reports.baselineRoomNights')}
                  value={reportData.baseline?.roomNights ?? 0}
                  icon={TrendingUp}
                />
                <BiKpiCard
                  title={t('reports.currentRoomNights')}
                  value={reportData.current?.roomNights ?? 0}
                  icon={TrendingUp}
                />
                <BiKpiCard
                  title={t('reports.netPickup')}
                  value={reportData.pickup?.roomNights ?? 0}
                  icon={TrendingUp}
                />
              </div>
              {Array.isArray(reportData.daily) && reportData.daily.length > 0 ? (
                <BiPanel title={t('reports.dailyPickup')} icon={CalendarRange}>
                  <div className="overflow-x-auto">
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
                        {(
                          reportData.daily as Array<{
                            date: string;
                            roomNightsAdded: number;
                            roomNightsLost: number;
                            netPickup: number;
                          }>
                        ).map((row) => (
                          <tr key={row.date} className="border-b border-gray-50">
                            <td className="py-2">{row.date}</td>
                            <td className="py-2 text-right text-telivity-dark-teal">
                              +{row.roomNightsAdded}
                            </td>
                            <td className="py-2 text-right text-telivity-orange">
                              -{row.roomNightsLost}
                            </td>
                            <td className="py-2 text-right font-medium">
                              {row.netPickup >= 0 ? `+${row.netPickup}` : row.netPickup}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </BiPanel>
              ) : (
                <p className="text-sm text-telivity-mid-grey">{t('reports.noPickup')}</p>
              )}
            </div>
          )}

          {report === 'booking-pace' && (
            <div className="space-y-4">
              {reportData.summary && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <BiKpiCard
                    title={t('reports.avgRoomsOnBooks')}
                    value={
                      reportData.summary.avgRoomsOnBooks != null
                        ? Number(reportData.summary.avgRoomsOnBooks).toFixed(1)
                        : '—'
                    }
                    icon={TrendingUp}
                  />
                  <BiKpiCard
                    title={t('reports.totalNewBookings')}
                    value={reportData.summary.totalNewBookings ?? 0}
                    icon={BarChart3}
                  />
                </div>
              )}
              <BiPanel title={t('reports.bookingPace')} icon={CalendarRange}>
                <PaceDualLineChart
                  data={
                    (reportData.daily ?? []) as {
                      date: string;
                      roomsOnBooks: number;
                      newBookings: number;
                    }[]
                  }
                  emptyLabel={t('reports.noPace')}
                  roomsLabel={t('reports.roomsOnBooks')}
                  bookingsLabel={t('reports.newBookings')}
                />
              </BiPanel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
