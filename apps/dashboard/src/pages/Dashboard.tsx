import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Wallet,
  ShieldCheck,
  Sparkles,
  CalendarClock,
  ArrowRight,
  ClipboardCheck,
  BarChart3,
} from 'lucide-react';
import { addDays, format, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { formatOccupancyPercent } from '../lib/api-helpers';
import { getDateLocale } from '../lib/date-locale';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../lib/socket';
import { formatMoney } from '../lib/money';
import {
  personaHeadlineKey,
  personaSubtitleKey,
  resolveDashboardPersona,
  type DashboardPersona,
} from '../lib/dashboard-persona';
import BiHero from '../components/bi/BiHero';
import BiKpiCard from '../components/bi/BiKpiCard';
import BiPanel from '../components/bi/BiPanel';
import ExceptionAlerts, { buildFinanceExceptions } from '../components/bi/ExceptionAlerts';
import { periodRange, type BiPeriod } from '../components/bi/PeriodChips';
import {
  OccupancyTrendChart,
  PaymentMethodBars,
  PortfolioRevenueBars,
  PaceDualLineChart,
  RevenueMixBars,
  RoomStatusDonut,
} from '../components/bi/BiCharts';

interface ActivityEvent {
  id: string;
  event: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

function pctDelta(current: number | null | undefined, prior: number | null | undefined): number | undefined {
  if (current == null || prior == null || prior === 0) return undefined;
  return ((Number(current) - Number(prior)) / Math.abs(Number(prior))) * 100;
}

function listLen(data: unknown): number {
  const list = (data as { data?: unknown })?.data ?? data;
  return Array.isArray(list) ? list.length : 0;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { propertyId, setPropertyId, isPortfolioMode, properties, currencyCode } = useProperty();
  const { permissions, authEnabled, hasPermission } = useAuth();
  const navigate = useNavigate();
  const now = new Date();
  const dateLocale = getDateLocale(i18n.resolvedLanguage);
  const formattedToday = format(now, 'PPPP', { locale: dateLocale });
  const [period, setPeriod] = useState<BiPeriod>('today');
  const range = useMemo(() => periodRange(period, now), [period, now]);

  const persona: DashboardPersona = useMemo(
    () => resolveDashboardPersona(permissions, authEnabled),
    [permissions, authEnabled],
  );

  const canReports = !authEnabled || hasPermission('reports.view');
  const canHk = !authEnabled || hasPermission('housekeeping.read');
  const canRevenue = !authEnabled || hasPermission('revenue.manage');
  const canAccounting = !authEnabled || hasPermission('accounting.view');

  const activeProperty = isPortfolioMode ? null : properties.find((p) => p.id === propertyId);
  const thr = activeProperty?.settings?.kpiThresholds ?? {};
  const money = (n: number) => formatMoney(n, currencyCode);

  const periodLabels: Record<BiPeriod, string> = {
    today: t('dashboard.period.today'),
    yesterday: t('dashboard.period.yesterday'),
    '7d': t('dashboard.period.sevenDay'),
    '30d': t('dashboard.period.thirtyDay'),
    mtd: t('dashboard.period.mtd'),
  };

  // ---- Portfolio queries ----
  const { data: portfolioFinancial } = useQuery({
    queryKey: ['reports', 'portfolio', 'financial-summary', range.date],
    queryFn: () =>
      api.get('/v1/reports/portfolio/financial-summary', { params: { date: range.date } }).then((r) => r.data),
    enabled: isPortfolioMode && canReports,
  });

  const { data: portfolioOccupancy } = useQuery({
    queryKey: ['reports', 'portfolio', 'occupancy', range.date],
    queryFn: () =>
      api.get('/v1/reports/portfolio/occupancy', { params: { date: range.date } }).then((r) => r.data),
    enabled: isPortfolioMode && canReports,
  });

  // ---- Property finance / ops queries ----
  const { data: financial } = useQuery({
    queryKey: ['reports', 'financial-summary', propertyId, range.date],
    queryFn: () =>
      api
        .get('/v1/reports/financial-summary', { params: { propertyId, date: range.date } })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canReports,
  });

  const { data: financialCompare } = useQuery({
    queryKey: ['reports', 'financial-summary', propertyId, range.compareDate],
    queryFn: () =>
      api
        .get('/v1/reports/financial-summary', {
          params: { propertyId, date: range.compareDate },
        })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canReports && period === 'today',
  });

  const { data: occupancy } = useQuery({
    queryKey: ['reports', 'occupancy', propertyId, range.date],
    queryFn: () =>
      api.get('/v1/reports/occupancy', { params: { propertyId, date: range.date } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canReports,
  });

  const { data: dailyRevenue } = useQuery({
    queryKey: ['reports', 'daily-revenue', propertyId, range.date],
    queryFn: () =>
      api
        .get('/v1/reports/daily-revenue', { params: { propertyId, date: range.date } })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canReports && (persona === 'manager' || persona === 'accounting'),
  });

  const trendStart = range.startDate;
  const trendEnd = range.endDate;

  const { data: occupancyTrend } = useQuery({
    queryKey: ['reports', 'occupancy-trend', propertyId, trendStart, trendEnd],
    queryFn: () =>
      api
        .get('/v1/reports/occupancy-trend', {
          params: { propertyId, startDate: trendStart, endDate: trendEnd },
        })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canReports,
  });

  const paceStart =
    period === 'today' || period === 'yesterday'
      ? format(subDays(now, 13), 'yyyy-MM-dd')
      : range.startDate;
  const { data: bookingPace } = useQuery({
    queryKey: ['reports', 'booking-pace', propertyId, paceStart, trendEnd],
    queryFn: () =>
      api
        .get('/v1/reports/booking-pace', {
          params: { propertyId, startDate: paceStart, endDate: trendEnd },
        })
        .then((r) => r.data),
    enabled:
      !!propertyId &&
      !isPortfolioMode &&
      canReports &&
      (persona === 'revenue' || persona === 'manager'),
  });

  const stayDate = format(addDays(now, 14), 'yyyy-MM-dd');
  const { data: pickup } = useQuery({
    queryKey: ['reports', 'pickup', propertyId, stayDate],
    queryFn: () =>
      api
        .get('/v1/reports/pickup', {
          params: {
            propertyId,
            stayDate,
            from: format(subDays(now, 7), 'yyyy-MM-dd'),
            to: format(now, 'yyyy-MM-dd'),
          },
        })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canReports && persona === 'revenue',
  });

  const { data: roomSummary } = useQuery({
    queryKey: ['rooms', 'status-summary', propertyId],
    queryFn: () => api.get('/v1/rooms/status-summary', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const today = format(now, 'yyyy-MM-dd');

  const { data: arrivals } = useQuery({
    queryKey: ['reservations', 'arrivals', propertyId, today],
    queryFn: () =>
      api
        .get('/v1/reservations', {
          params: { propertyId, status: 'confirmed', arrivalDateFrom: today, arrivalDateTo: today },
        })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: departures } = useQuery({
    queryKey: ['reservations', 'departures', propertyId, today],
    queryFn: () =>
      api
        .get('/v1/reservations', {
          params: {
            propertyId,
            status: 'checked_in',
            departureDateFrom: today,
            departureDateTo: today,
          },
        })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: inHouse } = useQuery({
    queryKey: ['reservations', 'in-house', propertyId],
    queryFn: () =>
      api.get('/v1/reservations', { params: { propertyId, status: 'checked_in' } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode,
  });

  const { data: agentStatuses } = useQuery({
    queryKey: ['agents', propertyId],
    queryFn: () => api.get(`/v1/agents/${propertyId}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId && !isPortfolioMode && canRevenue,
  });

  const { data: hkDash } = useQuery({
    queryKey: ['housekeeping', 'dashboard', propertyId, today],
    queryFn: () =>
      api
        .get('/v1/housekeeping/dashboard', { params: { propertyId, serviceDate: today } })
        .then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canHk && (persona === 'housekeeping' || persona === 'manager'),
  });

  const { data: arAging } = useQuery({
    queryKey: ['ar-aging', 'property', propertyId],
    queryFn: () => api.get('/v1/ar/aging', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId && !isPortfolioMode && canAccounting && persona === 'accounting',
  });

  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const handleEvent = useCallback((payload: ActivityEvent) => {
    setActivities((prev) => [payload, ...prev].slice(0, 12));
  }, []);

  useEffect(() => {
    if (isPortfolioMode) return;
    const socket = getSocket();
    socket.on('pmsEvent', handleEvent);
    return () => {
      socket.off('pmsEvent', handleEvent);
    };
  }, [handleEvent, isPortfolioMode]);

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('dashboard.selectProperty')}
      </div>
    );
  }

  // ========== PORTFOLIO ==========
  if (isPortfolioMode) {
    const fin = portfolioFinancial?.data ?? portfolioFinancial ?? {};
    const occ = portfolioOccupancy?.data ?? portfolioOccupancy ?? {};
    const kpis = fin.kpis ?? {};
    const byProperty = fin.byProperty ?? [];
    const propertyNameMap = new Map(properties.map((p) => [p.id, p.name]));
    const chartData = byProperty.map((row: { propertyId: string; totalRevenue: number }) => ({
      name: propertyNameMap.get(row.propertyId) ?? row.propertyId.slice(0, 8),
      revenue: Number(row.totalRevenue),
    }));

    return (
      <div>
        <BiHero
          eyebrow={t('dashboard.biEyebrow')}
          title={t('dashboard.portfolio.title')}
          subtitle={t('dashboard.portfolio.subtitle')}
          dateLabel={`${t('dashboard.portfolio.propertyCount', { count: fin.propertyCount ?? properties.length })} · ${formattedToday}`}
          icon={Building2}
          period={period}
          onPeriodChange={setPeriod}
          periodLabels={periodLabels}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <BiKpiCard
            title={t('dashboard.portfolio.occupancy')}
            value={formatOccupancyPercent(kpis.occupancyRate)}
            subtitle={t('dashboard.occupiedOfRooms', {
              occupied: occ.occupiedRooms ?? 0,
              total: occ.availableRooms ?? 0,
            })}
            icon={Percent}
          />
          <BiKpiCard
            title={t('dashboard.portfolio.adr')}
            value={kpis.adr != null ? money(kpis.adr) : '—'}
            subtitle={t('dashboard.portfolio.weightedAverage')}
            icon={DollarSign}
          />
          <BiKpiCard
            title={t('dashboard.portfolio.revpar')}
            value={kpis.revpar != null ? money(kpis.revpar) : '—'}
            subtitle={t('dashboard.portfolio.acrossAllProperties')}
            icon={TrendingUp}
          />
          <BiKpiCard
            title={t('dashboard.portfolio.totalRevenueToday')}
            value={kpis.totalRevenue != null ? money(kpis.totalRevenue) : '—'}
            subtitle={t('dashboard.portfolio.arrivalsAndDepartures', {
              arrivals: occ.arrivals ?? 0,
              departures: occ.departures ?? 0,
            })}
            icon={BedDouble}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-6">
          <BiPanel
            className="xl:col-span-3"
            title={t('dashboard.portfolio.revenueByProperty')}
            icon={BarChart3}
          >
            <PortfolioRevenueBars
              data={chartData}
              currencyFmt={money}
              revenueLabel={t('dashboard.portfolio.revenue')}
            />
          </BiPanel>
          <BiPanel
            className="xl:col-span-2"
            title={t('dashboard.portfolio.propertyBreakdown')}
            icon={Building2}
            tone="teal"
          >
            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-telivity-mid-grey border-b border-gray-100">
                    <th className="pb-2 font-medium">{t('dashboard.portfolio.property')}</th>
                    <th className="pb-2 font-medium">{t('dashboard.occupancy')}</th>
                    <th className="pb-2 font-medium">{t('dashboard.portfolio.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byProperty.map(
                    (row: {
                      propertyId: string;
                      occupancyRate: number;
                      totalRevenue: number;
                    }) => (
                      <tr key={row.propertyId} className="border-b border-gray-50 last:border-0">
                        <td className="py-2.5 font-medium text-telivity-navy">
                          <button
                            type="button"
                            className="hover:text-telivity-teal"
                            onClick={() => setPropertyId(row.propertyId)}
                          >
                            {propertyNameMap.get(row.propertyId) ?? row.propertyId}
                          </button>
                        </td>
                        <td className="py-2.5">{formatOccupancyPercent(row.occupancyRate)}</td>
                        <td className="py-2.5">{money(row.totalRevenue)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </BiPanel>
        </div>
      </div>
    );
  }

  // ========== PROPERTY DATA ==========
  const occ = occupancy?.data ?? occupancy ?? {};
  const fin = financial?.data ?? financial ?? {};
  const kpis = fin.kpis ?? {};
  const compareKpis = (financialCompare?.data ?? financialCompare ?? {}).kpis ?? {};
  const outstanding = fin.outstandingBalances ?? {};
  const audit = fin.auditStatus ?? {};
  const revenueByType = fin.revenueByType ?? {};
  const daily = dailyRevenue?.data ?? dailyRevenue ?? {};
  const payments = daily.payments ?? fin.paymentsByMethod ?? {};

  const arrCount = listLen(arrivals);
  const depCount = listLen(departures);
  const ihCount = listLen(inHouse);

  const roomData = roomSummary?.data ?? roomSummary ?? [];
  const chartData = Array.isArray(roomData)
    ? roomData.map((r: { status: string; count: number }) => ({
        name: t(`dashboard.roomStatuses.${r.status}`, {
          defaultValue: r.status.replace(/_/g, ' '),
        }),
        status: r.status,
        value: Number(r.count),
      }))
    : [];
  const totalRooms = chartData.reduce((sum: number, d: { value: number }) => sum + d.value, 0);
  const occupiedCount =
    chartData.find((d: { status: string }) => d.status === 'occupied')?.value ?? 0;
  const oooCount =
    chartData.find((d: { status: string }) => d.status === 'out_of_order')?.value ??
    occ.outOfOrder ??
    0;

  const trendDaily = ((occupancyTrend?.data ?? occupancyTrend ?? {}).daily ?? []) as {
    date: string;
    occupancyRate: number;
  }[];
  const occSpark = trendDaily.slice(-14).map((d) => Number(d.occupancyRate) * 100);
  const trendChart = trendDaily.map((d) => ({
    date: d.date.slice(5),
    occupancyPct: Number(d.occupancyRate) * 100,
  }));

  const revMix = Object.entries(revenueByType as Record<string, number>).map(([k, v]) => ({
    name: k.replace(/_/g, ' '),
    amount: Number(v),
  }));
  const payMix = Object.entries(payments as Record<string, number>)
    .filter(([k]) => k !== 'total')
    .map(([k, v]) => ({ method: k.replace(/_/g, ' '), amount: Number(v) }));

  const pendingDecisions = Array.isArray(agentStatuses)
    ? agentStatuses.reduce(
        (s: number, a: { pendingDecisions?: number }) => s + (a.pendingDecisions ?? 0),
        0,
      )
    : 0;

  const exceptions =
    canReports
      ? buildFinanceExceptions({
          outstandingBalance: Number(outstanding.totalBalanceDue ?? 0),
          openFolios: Number(outstanding.totalFoliosOpen ?? 0),
          lastAuditStatus: audit.lastAuditStatus ?? null,
          auditErrors: Number(audit.errorsInLastAudit ?? 0),
          ooo: Number(oooCount),
          pendingDecisions,
          currencyFmt: money,
          labels: {
            openBalances: t('dashboard.exceptions.openBalances'),
            openBalancesDetail: t('dashboard.exceptions.openBalancesDetail'),
            auditOk: t('dashboard.exceptions.auditOk'),
            auditFail: t('dashboard.exceptions.auditFail'),
            auditFailDetail: t('dashboard.exceptions.auditFailDetail'),
            ooo: t('dashboard.exceptions.ooo'),
            oooDetail: t('dashboard.exceptions.oooDetail'),
            pendingAgents: t('dashboard.exceptions.pendingAgents'),
            pendingAgentsDetail: t('dashboard.exceptions.pendingAgentsDetail'),
          },
        })
      : [];

  const occTrendPct = pctDelta(kpis.occupancyRate ?? occ.occupancyRate, compareKpis.occupancyRate);
  const adrTrendPct = pctDelta(kpis.adr, compareKpis.adr);
  const revparTrendPct = pctDelta(kpis.revpar, compareKpis.revpar);
  const revTrendPct = pctDelta(kpis.totalRevenue, compareKpis.totalRevenue);

  const vsLabel = t('dashboard.vsPriorDay');

  const hk = hkDash?.data ?? hkDash ?? {};
  const hkTasks = hk.taskSummary ?? {};
  const hkUrgent = (hk.urgentRooms ?? []) as { roomNumber?: string; reason?: string }[];

  const pace = bookingPace?.data ?? bookingPace ?? {};
  const paceDaily = (pace.daily ?? []) as {
    date: string;
    roomsOnBooks: number;
    newBookings: number;
  }[];
  const pickupData = pickup?.data ?? pickup ?? {};

  const aging = arAging?.data ?? arAging ?? {};
  const agingBuckets = (aging.buckets ?? {}) as Record<string, number | string>;

  const quickLinks = [
    canReports && {
      label: t('dashboard.quick.reports'),
      href: '/reports',
      icon: BarChart3,
    },
    (persona === 'front_office' || persona === 'manager' || persona === 'ops') && {
      label: t('dashboard.quick.frontDesk'),
      href: '/front-desk',
      icon: LogIn,
    },
    canHk && {
      label: t('dashboard.quick.housekeeping'),
      href: '/housekeeping',
      icon: Sparkles,
    },
    canRevenue && {
      label: t('dashboard.quick.revenue'),
      href: '/revenue',
      icon: Brain,
    },
    canAccounting && {
      label: t('dashboard.quick.accounting'),
      href: '/accounting',
      icon: Wallet,
    },
  ].filter(Boolean) as { label: string; href: string; icon: typeof BarChart3 }[];

  return (
    <div>
      <BiHero
        eyebrow={t('dashboard.biEyebrow')}
        title={t(personaHeadlineKey(persona))}
        subtitle={t(personaSubtitleKey(persona))}
        dateLabel={formattedToday}
        icon={LayoutDashboard}
        period={canReports ? period : undefined}
        onPeriodChange={canReports ? setPeriod : undefined}
        periodLabels={periodLabels}
        actions={
          <div className="flex flex-wrap gap-2">
            {quickLinks.slice(0, 3).map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => navigate(link.href)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <link.icon size={13} />
                {link.label}
              </button>
            ))}
          </div>
        }
      />

      {canReports && exceptions.length > 0 && (
        <div className="mb-6">
          <ExceptionAlerts items={exceptions} emptyLabel={t('dashboard.exceptions.allClear')} />
        </div>
      )}

      {/* KPI strip — finance personas */}
      {canReports && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <BiKpiCard
            title={t('dashboard.occupancy')}
            value={formatOccupancyPercent(occ.occupancyRate ?? kpis.occupancyRate)}
            subtitle={t('dashboard.occupiedOfRooms', {
              occupied: occ.occupiedRooms ?? occupiedCount,
              total: occ.availableRooms ?? totalRooms,
            })}
            icon={Percent}
            numericValue={
              occ.occupancyRate != null
                ? Number(occ.occupancyRate)
                : kpis.occupancyRate != null
                  ? Number(kpis.occupancyRate)
                  : undefined
            }
            threshold={thr.occupancyRate}
            sparkline={occSpark}
            trend={
              occTrendPct != null ? { value: occTrendPct, label: vsLabel } : undefined
            }
            onClick={() => navigate('/reports?report=occupancy')}
          />
          <BiKpiCard
            title={t('dashboard.adr')}
            value={kpis.adr != null ? money(kpis.adr) : '—'}
            subtitle={t('dashboard.averageDailyRate')}
            icon={DollarSign}
            numericValue={kpis.adr != null ? Number(kpis.adr) : undefined}
            threshold={thr.adr}
            trend={adrTrendPct != null ? { value: adrTrendPct, label: vsLabel } : undefined}
            onClick={() => navigate('/reports?report=financial-summary')}
          />
          <BiKpiCard
            title={t('dashboard.revpar')}
            value={kpis.revpar != null ? money(kpis.revpar) : '—'}
            subtitle={t('dashboard.revenuePerAvailableRoom')}
            icon={TrendingUp}
            numericValue={kpis.revpar != null ? Number(kpis.revpar) : undefined}
            threshold={thr.revpar}
            trend={
              revparTrendPct != null ? { value: revparTrendPct, label: vsLabel } : undefined
            }
            onClick={() => navigate('/reports?report=financial-summary')}
          />
          <BiKpiCard
            title={t('dashboard.revenueToday')}
            value={kpis.totalRevenue != null ? money(kpis.totalRevenue) : '—'}
            subtitle={t('dashboard.revenueBreakdown')}
            icon={BedDouble}
            numericValue={kpis.totalRevenue != null ? Number(kpis.totalRevenue) : undefined}
            threshold={thr.totalRevenue}
            trend={revTrendPct != null ? { value: revTrendPct, label: vsLabel } : undefined}
            onClick={() => navigate('/reports?report=daily-revenue')}
          />
        </div>
      )}

      {/* Front office / ops activity KPIs when no reports */}
      {!canReports && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <BiKpiCard title={t('dashboard.arrivals')} value={arrCount} icon={LogIn} onClick={() => navigate('/front-desk')} />
          <BiKpiCard title={t('dashboard.inHouse')} value={ihCount} icon={Users} />
          <BiKpiCard title={t('dashboard.departures')} value={depCount} icon={LogOut} onClick={() => navigate('/front-desk')} />
          <BiKpiCard
            title={t('dashboard.availableRooms')}
            value={Math.max(totalRooms - occupiedCount, 0)}
            icon={DoorOpen}
            onClick={() => navigate('/rooms')}
          />
        </div>
      )}

      {/* Manager / accounting finance depth */}
      {(persona === 'manager' || persona === 'accounting') && canReports && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <BiPanel title={t('dashboard.panels.revenueMix')} icon={DollarSign} tone="teal">
            <RevenueMixBars
              data={revMix}
              currencyFmt={money}
              emptyLabel={t('dashboard.panels.noRevenueMix')}
            />
          </BiPanel>
          <BiPanel title={t('dashboard.panels.paymentMix')} icon={Wallet}>
            <PaymentMethodBars
              data={payMix}
              currencyFmt={money}
              emptyLabel={t('dashboard.panels.noPayments')}
            />
          </BiPanel>
          <BiPanel title={t('dashboard.panels.ledgerHealth')} icon={ShieldCheck} tone="navy">
            <div className="space-y-4">
              <div>
                <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">
                  {t('dashboard.panels.openFolioBalance')}
                </p>
                <p className="text-2xl font-semibold text-white mt-1 tabular-nums">
                  {money(Number(outstanding.totalBalanceDue ?? 0))}
                </p>
                <p className="text-xs text-white/50 mt-1">
                  {t('dashboard.panels.openFolios', {
                    count: Number(outstanding.totalFoliosOpen ?? 0),
                  })}
                </p>
              </div>
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs text-white/60 uppercase tracking-wider font-semibold">
                  {t('dashboard.panels.lastAudit')}
                </p>
                <p className="text-sm text-white mt-1">
                  {audit.lastAuditDate
                    ? `${audit.lastAuditDate} · ${audit.lastAuditStatus ?? '—'}`
                    : t('dashboard.panels.noAudit')}
                </p>
              </div>
              {persona === 'accounting' && (
                <button
                  type="button"
                  onClick={() => navigate('/reports?report=trial-balance')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-telivity-light-teal hover:underline"
                >
                  {t('dashboard.panels.openTrialBalance')} <ArrowRight size={12} />
                </button>
              )}
            </div>
          </BiPanel>
        </div>
      )}

      {/* Revenue persona */}
      {(persona === 'revenue' || persona === 'manager') && canReports && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          <BiPanel
            title={t('dashboard.panels.occupancyTrend')}
            subtitle={
              period === '7d' || period === '30d' || period === 'mtd'
                ? periodLabels[period]
                : t('dashboard.panels.last30Days')
            }
            icon={TrendingUp}
          >
            <OccupancyTrendChart
              data={trendChart}
              emptyLabel={t('reports.noTrend')}
              valueLabel={t('dashboard.occupancy')}
            />
          </BiPanel>
          <BiPanel
            title={t('dashboard.panels.bookingPace')}
            subtitle={t('dashboard.panels.last14Days')}
            icon={CalendarClock}
          >
            <PaceDualLineChart
              data={paceDaily.map((d) => ({ ...d, date: d.date.slice(5) }))}
              emptyLabel={t('reports.noPace')}
              roomsLabel={t('reports.roomsOnBooks')}
              bookingsLabel={t('reports.newBookings')}
            />
          </BiPanel>
        </div>
      )}

      {persona === 'revenue' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <BiKpiCard
            title={t('reports.baselineRoomNights')}
            value={pickupData.baseline?.roomNights ?? '—'}
            icon={BedDouble}
          />
          <BiKpiCard
            title={t('reports.currentRoomNights')}
            value={pickupData.current?.roomNights ?? '—'}
            icon={TrendingUp}
          />
          <BiKpiCard
            title={t('reports.netPickup')}
            value={pickupData.pickup?.roomNights ?? '—'}
            subtitle={t('dashboard.panels.pickupStay', { date: stayDate })}
            icon={Sparkles}
            onClick={() => navigate('/reports?report=pickup')}
          />
        </div>
      )}

      {/* Accounting aging */}
      {persona === 'accounting' && (
        <div className="mb-6">
          <BiPanel title={t('dashboard.panels.arAging')} icon={Wallet} subtitle={t('dashboard.panels.arAgingHint')}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(
                [
                  ['current', 'dashboard.aging.current'],
                  ['days31to60', 'dashboard.aging.31_60'],
                  ['days61to90', 'dashboard.aging.61_90'],
                  ['days90plus', 'dashboard.aging.90_plus'],
                ] as const
              ).map(([key, labelKey]) => (
                <div key={key} className="rounded-xl bg-telivity-light-grey/80 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-telivity-mid-grey">
                    {t(labelKey)}
                  </p>
                  <p className="text-lg font-semibold text-telivity-navy mt-1 tabular-nums">
                    {money(Number(agingBuckets[key] ?? 0))}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => navigate('/accounting')}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-telivity-teal"
            >
              {t('dashboard.panels.openAccounting')} <ArrowRight size={12} />
            </button>
          </BiPanel>
        </div>
      )}

      {/* Housekeeping persona home */}
      {persona === 'housekeeping' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 grid grid-cols-2 gap-4">
            <BiKpiCard
              title={t('dashboard.hk.pending')}
              value={hkTasks.pending ?? 0}
              icon={ClipboardCheck}
              onClick={() => navigate('/housekeeping')}
            />
            <BiKpiCard title={t('dashboard.hk.inProgress')} value={hkTasks.in_progress ?? 0} icon={Sparkles} />
            <BiKpiCard title={t('dashboard.hk.completed')} value={hkTasks.completed ?? 0} icon={ShieldCheck} />
            <BiKpiCard title={t('dashboard.hk.urgent')} value={hkUrgent.length} icon={DoorOpen} />
          </div>
          <BiPanel title={t('dashboard.hk.urgentRooms')} icon={DoorOpen} tone="teal">
            {hkUrgent.length ? (
              <ul className="space-y-2">
                {hkUrgent.slice(0, 6).map((r, i) => (
                  <li key={i} className="flex justify-between text-sm border-b border-gray-100 pb-2">
                    <span className="font-medium text-telivity-navy">
                      {t('dashboard.hk.room', { number: r.roomNumber ?? '—' })}
                    </span>
                    <span className="text-xs text-telivity-slate">{r.reason ?? ''}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-telivity-mid-grey">{t('dashboard.hk.noUrgent')}</p>
            )}
            <button
              type="button"
              onClick={() => navigate('/housekeeping')}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-telivity-teal"
            >
              {t('dashboard.quick.housekeeping')} <ArrowRight size={12} />
            </button>
          </BiPanel>
        </div>
      )}

      {/* Ops + room board — all personas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <BiPanel title={t('dashboard.todaysActivity')} icon={Users}>
          <div className="space-y-3">
            {[
              { icon: LogIn, color: 'text-telivity-teal', bg: 'bg-telivity-teal/10', value: arrCount, label: t('dashboard.arrivals') },
              { icon: Users, color: 'text-telivity-deep-blue', bg: 'bg-telivity-deep-blue/10', value: ihCount, label: t('dashboard.inHouse') },
              { icon: LogOut, color: 'text-telivity-orange', bg: 'bg-telivity-orange/10', value: depCount, label: t('dashboard.departures') },
              {
                icon: DoorOpen,
                color: 'text-telivity-dark-teal',
                bg: 'bg-telivity-dark-teal/10',
                value: Math.max(totalRooms - occupiedCount, 0),
                label: t('dashboard.availableRooms'),
              },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${row.bg}`}>
                  <row.icon size={16} className={row.color} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-telivity-navy tabular-nums">{row.value}</p>
                  <p className="text-xs text-telivity-mid-grey">{row.label}</p>
                </div>
              </div>
            ))}
          </div>
        </BiPanel>

        <BiPanel className="lg:col-span-2" title={t('dashboard.roomStatus')} icon={BedDouble}>
          <RoomStatusDonut data={chartData} emptyLabel={t('dashboard.noRoomData')} />
        </BiPanel>
      </div>

      {canRevenue && Array.isArray(agentStatuses) && agentStatuses.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('/revenue')}
          className="w-full text-left bg-white rounded-2xl shadow-sm border border-black/[0.03] p-5 mb-6 hover:ring-2 hover:ring-telivity-teal/30 transition-all bi-enter"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-telivity-teal/10 rounded-xl">
              <Brain size={20} className="text-telivity-teal" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-telivity-navy">
                {t('dashboard.revenueIntelligence')}
              </h2>
              <p className="text-xs text-telivity-mid-grey mt-0.5">
                {t('dashboard.activeAgents', {
                  count: agentStatuses.filter((a: { isEnabled: boolean }) => a.isEnabled).length,
                })}
                {' · '}
                {t('dashboard.pendingDecisions', { count: pendingDecisions })}
              </p>
            </div>
            <span className="text-xs text-telivity-teal font-semibold">
              {t('dashboard.viewRevenueManagement')} →
            </span>
          </div>
        </button>
      )}

      <BiPanel title={t('dashboard.recentActivityLive')} icon={Sparkles}>
        {activities.length > 0 ? (
          <div className="space-y-2">
            {activities.map((a, i) => (
              <div
                key={`${a.timestamp}-${i}`}
                className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0"
              >
                <div className="w-2 h-2 rounded-full bg-telivity-teal flex-shrink-0 animate-pulse" />
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
      </BiPanel>
    </div>
  );
}
