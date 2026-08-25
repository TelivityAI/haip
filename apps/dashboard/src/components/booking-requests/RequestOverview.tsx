import { CalendarDays, Contact, CreditCard, FileText, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../../lib/money';
import { quoteTotal, type BookingRequestDetail } from './types';

function displayAnswer(value: unknown, yes: string, no: string, unavailable: string): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? yes : no;
  if (Array.isArray(value)) {
    const safe = value.filter((item): item is string => typeof item === 'string');
    return safe.length ? safe.join(', ') : unavailable;
  }
  return unavailable;
}

function OverviewCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof CalendarDays;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-telivity-slate">
        <Icon size={17} className="text-telivity-deep-blue" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function RequestOverview({ request }: { request: BookingRequestDetail }) {
  const { t } = useTranslation();
  const submittedTotal = quoteTotal(request.submittedQuoteSnapshot);
  const currentTotal = quoteTotal(request.currentQuoteSnapshot);
  const difference = submittedTotal && currentTotal
    ? Number(currentTotal) - Number(submittedTotal)
    : null;
  const questions = [...(request.formSnapshot ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
      <div className="space-y-4">
        <OverviewCard icon={CalendarDays} title={t('bookingRequests.overview.stay')}>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-telivity-slate">{t('bookingRequests.overview.dates')}</dt>
              <dd className="mt-1 font-semibold text-telivity-navy">
                {request.arrivalDate} → {request.departureDate}
              </dd>
            </div>
            <div>
              <dt className="text-telivity-slate">{t('bookingRequests.overview.occupancy')}</dt>
              <dd className="mt-1 font-semibold text-telivity-navy">
                {t('bookingRequests.overview.occupancyValue', {
                  adults: request.adults,
                  children: request.children,
                })}
              </dd>
            </div>
            <div>
              <dt className="text-telivity-slate">{t('bookingRequests.overview.roomType')}</dt>
              <dd className="mt-1 break-all font-medium text-telivity-navy">{request.roomTypeId}</dd>
            </div>
            <div>
              <dt className="text-telivity-slate">{t('bookingRequests.overview.ratePlan')}</dt>
              <dd className="mt-1 break-all font-medium text-telivity-navy">{request.ratePlanId}</dd>
            </div>
          </dl>
        </OverviewCard>

        <OverviewCard icon={Contact} title={t('bookingRequests.overview.guest')}>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-telivity-slate">{t('bookingRequests.overview.email')}</dt><dd className="mt-1 break-all font-medium text-telivity-navy">{request.guestEmail}</dd></div>
            <div><dt className="text-telivity-slate">{t('bookingRequests.overview.phone')}</dt><dd className="mt-1 font-medium text-telivity-navy">{request.guestPhone || '—'}</dd></div>
          </dl>
          {request.specialRequests ? (
            <div className="mt-4 border-t border-slate-100 pt-4 text-sm">
              <p className="text-telivity-slate">{t('bookingRequests.overview.specialRequests')}</p>
              <p className="mt-1 whitespace-pre-wrap text-telivity-navy">{request.specialRequests}</p>
            </div>
          ) : null}
        </OverviewCard>

        <OverviewCard icon={FileText} title={t('bookingRequests.overview.application')}>
          {questions.length ? (
            <dl className="divide-y divide-slate-100">
              {questions.map((question) => (
                <div key={question.id} className="py-3 first:pt-0 last:pb-0">
                  <dt className="text-sm font-medium text-telivity-slate">{question.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-telivity-navy">
                    {displayAnswer(
                      request.applicationAnswers?.[question.id],
                      t('bookingRequests.common.yes'),
                      t('bookingRequests.common.no'),
                      t('bookingRequests.common.notProvided'),
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-telivity-slate">{t('bookingRequests.overview.noQuestions')}</p>
          )}
        </OverviewCard>
      </div>

      <div className="space-y-4">
        <OverviewCard icon={Scale} title={t('bookingRequests.overview.priceComparison')}>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-telivity-slate">{t('bookingRequests.amounts.submitted')}</dt>
              <dd className="font-semibold text-telivity-navy">{formatMoney(submittedTotal, request.currencyCode)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-telivity-slate">{t('bookingRequests.amounts.current')}</dt>
              <dd className="text-right font-semibold text-telivity-navy">
                {currentTotal
                  ? formatMoney(currentTotal, request.currencyCode)
                  : t('bookingRequests.accept.recheckedOnAccept')}
              </dd>
            </div>
            {difference != null ? (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <dt className="text-telivity-slate">{t('bookingRequests.amounts.difference')}</dt>
                <dd className={`font-semibold ${difference > 0 ? 'text-telivity-orange' : 'text-telivity-dark-teal'}`}>
                  {difference > 0 ? '+' : ''}{formatMoney(difference, request.currencyCode)}
                </dd>
              </div>
            ) : null}
            {request.acceptedTotal ? (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <dt className="font-semibold text-telivity-navy">{t('bookingRequests.amounts.accepted')}</dt>
                <dd className="font-semibold text-telivity-navy">{formatMoney(request.acceptedTotal, request.currencyCode)}</dd>
              </div>
            ) : null}
          </dl>
        </OverviewCard>

        <OverviewCard icon={CreditCard} title={t('bookingRequests.overview.card')}>
          {request.card ? (
            <p className="text-sm font-semibold text-telivity-navy">
              {(request.card.brand || t('bookingRequests.overview.cardGeneric')).toUpperCase()} •••• {request.card.lastFour || '••••'}
            </p>
          ) : (
            <p className="text-sm text-telivity-slate">{t('bookingRequests.overview.noCard')}</p>
          )}
          <p className="mt-2 text-xs leading-5 text-telivity-slate">{t('bookingRequests.overview.cardSafety')}</p>
        </OverviewCard>

        {request.status !== 'pending' ? (
          <OverviewCard icon={FileText} title={t('bookingRequests.overview.decision')}>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-telivity-slate">{t('bookingRequests.common.status')}</dt><dd className="font-semibold capitalize text-telivity-navy">{t(`bookingRequests.statuses.${request.status}`)}</dd></div>
              {request.acceptedPriceSource ? <div className="flex justify-between gap-3"><dt className="text-telivity-slate">{t('bookingRequests.overview.priceSource')}</dt><dd className="font-medium text-telivity-navy">{t(`bookingRequests.priceSources.${request.acceptedPriceSource}`)}</dd></div> : null}
              {request.denialReason ? <div><dt className="text-telivity-slate">{t('bookingRequests.deny.reason')}</dt><dd className="mt-1 whitespace-pre-wrap text-telivity-navy">{request.denialReason}</dd></div> : null}
              {request.customPriceReason ? <div><dt className="text-telivity-slate">{t('bookingRequests.accept.customReason')}</dt><dd className="mt-1 whitespace-pre-wrap text-telivity-navy">{request.customPriceReason}</dd></div> : null}
            </dl>
          </OverviewCard>
        ) : null}
      </div>
    </div>
  );
}
