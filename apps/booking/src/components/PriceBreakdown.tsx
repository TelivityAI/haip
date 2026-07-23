import type { QuoteResponse } from '../api/types';
import { money } from '../lib/format';

export function PriceBreakdown({ quote }: { quote: QuoteResponse }) {
  const { currencyCode } = quote;
  const services = quote.services ?? [];
  const servicesTotal = Number(quote.servicesTotal ?? 0);
  const servicesTaxTotal = Number(quote.servicesTaxTotal ?? 0);

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 text-sm">
      <div className="mb-3 font-semibold text-gray-900">
        {quote.nights} night{quote.nights === 1 ? '' : 's'}
      </div>
      <ul className="space-y-1">
        {quote.lineItems.map((li) => (
          <li key={li.date} className="flex justify-between text-gray-600">
            <span>{li.date}</span>
            <span>
              {money(li.rate, currencyCode)}
              {Number(li.tax) > 0 && (
                <span className="text-gray-400"> + {money(li.tax, currencyCode)} tax</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {services.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
          {services.map((s) => (
            <li key={s.serviceId} className="flex justify-between text-gray-600">
              <span>
                {s.name}
                {s.postingRule === 'on_consumption' && (
                  <span className="text-gray-400"> (pay later)</span>
                )}
              </span>
              <span>
                {s.postingRule === 'on_consumption'
                  ? money(0, currencyCode)
                  : money(s.lineTotal, currencyCode)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
        <Row label="Room" value={money(quote.roomTotal, currencyCode)} />
        <Row label="Taxes & fees" value={money(quote.taxTotal, currencyCode)} />
        {(servicesTotal > 0 || servicesTaxTotal > 0) && (
          <>
            <Row label="Extras" value={money(quote.servicesTotal ?? '0', currencyCode)} />
            {servicesTaxTotal > 0 && (
              <Row label="Extras tax" value={money(quote.servicesTaxTotal ?? '0', currencyCode)} />
            )}
          </>
        )}
        <Row label="Total" value={money(quote.grandTotal, currencyCode)} bold />
        <Row
          label={
            quote.depositPolicy.refundable
              ? 'Deposit due now (refundable)'
              : 'Deposit due now'
          }
          value={money(quote.depositDue, currencyCode)}
        />
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
