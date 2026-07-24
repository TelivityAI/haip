import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { api } from '../../lib/api';
import { requirePropertyId } from '../../lib/api-helpers';
import { useTranslation } from 'react-i18next';

interface RateRestriction {
  id: string;
  startDate: string;
  endDate: string;
  minLos?: number | null;
  maxLos?: number | null;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  isClosed?: boolean;
  dayOfWeekOverrides?: Record<string, number> | null;
}

interface CalendarDay {
  date: string;
  baseRate: number;
  effectiveRate: number;
  badges: string[];
}

function eachDateInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const endAt = new Date(`${end}T12:00:00`);
  while (cursor <= endAt) {
    dates.push(format(cursor, 'yyyy-MM-dd'));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function restrictionCovers(r: RateRestriction, date: string) {
  return r.startDate <= date && r.endDate >= date;
}

function dayName(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

function buildCalendarDays(
  dates: string[],
  baseRate: number,
  restrictions: RateRestriction[],
): CalendarDay[] {
  return dates.map((date) => {
    const matching = restrictions.filter((r) => restrictionCovers(r, date));
    const day = dayName(date);
    let effectiveRate = baseRate;
    for (const r of matching) {
      const override = r.dayOfWeekOverrides?.[day];
      if (override != null) {
        effectiveRate = baseRate + override;
      }
    }

    const badges: string[] = [];
    for (const r of matching) {
      if (r.isClosed) badges.push('Closed');
      if (r.closedToArrival) badges.push('CTA');
      if (r.closedToDeparture) badges.push('CTD');
      if (r.minLos) badges.push(`MinLOS ${r.minLos}`);
      if (r.maxLos) badges.push(`MaxLOS ${r.maxLos}`);
    }

    return {
      date,
      baseRate,
      effectiveRate,
      badges: [...new Set(badges)],
    };
  });
}

interface RatePlanCalendarProps {
  ratePlanId: string;
  propertyId: string | null;
  baseAmount: number;
}

export default function RatePlanCalendar({ ratePlanId, propertyId, baseAmount }: RatePlanCalendarProps) {
  const { t } = useTranslation();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(format(addDays(new Date(), 13), 'yyyy-MM-dd'));

  const { data: restrictionsData, isLoading: restrictionsLoading } = useQuery({
    queryKey: ['rate-plans', ratePlanId, 'restrictions', propertyId],
    queryFn: () => {
      requirePropertyId(propertyId);
      return api
        .get(`/v1/rate-plans/${ratePlanId}/restrictions`, { params: { propertyId } })
        .then((r) => r.data);
    },
    enabled: !!ratePlanId && !!propertyId,
  });

  const { data: effectiveData, isLoading: effectiveLoading } = useQuery({
    queryKey: ['rate-plans', ratePlanId, 'effective-rate', propertyId],
    queryFn: () => {
      requirePropertyId(propertyId);
      return api
        .get(`/v1/rate-plans/${ratePlanId}/effective-rate`, { params: { propertyId } })
        .then((r) => r.data);
    },
    enabled: !!ratePlanId && !!propertyId,
  });

  const restrictions: RateRestriction[] = restrictionsData?.data ?? restrictionsData ?? [];
  const effectivePayload = effectiveData?.data ?? effectiveData ?? {};
  const chainBaseRate = Number(effectivePayload.effectiveRate ?? baseAmount);

  const days = useMemo(() => {
    if (!startDate || !endDate || startDate > endDate) return [];
    return buildCalendarDays(eachDateInclusive(startDate, endDate), chainBaseRate, restrictions);
  }, [startDate, endDate, chainBaseRate, restrictions]);

  const loading = restrictionsLoading || effectiveLoading;

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mt-6">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <h2 className="text-sm font-semibold text-telivity-navy mr-auto">{t('ratePlans.calendar')}</h2>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.from')}</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reports.to')}</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-telivity-mid-grey">{t('common.loading')}</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-telivity-mid-grey">{t('ratePlans.calendarEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('reports.date')}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.baseRate')}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.effectiveRate')}</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('ratePlans.restrictions')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day.date} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-3 py-2 text-sm text-telivity-slate">{day.date}</td>
                  <td className="px-3 py-2 text-sm text-right text-telivity-mid-grey">${day.baseRate.toFixed(2)}</td>
                  <td className="px-3 py-2 text-sm text-right font-medium text-telivity-navy">${day.effectiveRate.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {day.badges.length === 0 ? (
                        <span className="text-xs text-telivity-mid-grey">—</span>
                      ) : (
                        day.badges.map((badge) => (
                          <span
                            key={badge}
                            className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 bg-telivity-teal/10 text-telivity-teal"
                          >
                            {badge}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
