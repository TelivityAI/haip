import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Search, X } from 'lucide-react';
import { useProperty } from '../../context/PropertyContext';

/** Only these views implement aggregation or individually scoped reads.
 * A portfolio is a UI selection, never an API tenant identifier. */
export function supportsPortfolio(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === '/' || path === '/reports' || path.startsWith('/reports/')
    || path === '/channels' || path === '/channels/ical';
}

export default function PropertyScopeBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { propertyId, isPortfolioMode } = useProperty();

  if (propertyId && (!isPortfolioMode || supportsPortfolio(pathname))) return children;

  return <PropertyChooser />;
}

const PAGE_SIZE = 50;
function searchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function PropertyChooser() {
  const { t, i18n } = useTranslation();
  const { properties, propertiesLoading, propertiesError, setPropertyId } = useProperty();
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const searchInput = useRef<HTMLInputElement>(null);
  const indexed = useMemo(() => properties.map(property => ({
    property, searchable: searchText(`${property.name} ${property.code}`),
  })), [properties]);
  const matches = useMemo(() => {
    const term = searchText(query.trim());
    return term ? indexed.filter(item => item.searchable.includes(term)) : indexed;
  }, [indexed, query]);
  const shown = matches.slice(0, visibleCount);
  const clearSearch = () => {
    setQuery(''); setVisibleCount(PAGE_SIZE); searchInput.current?.focus();
  };

  return (
    <div className="flex flex-1 items-center justify-center py-6">
    <section aria-labelledby="property-scope-title" className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 sm:p-8">
      <h1 id="property-scope-title" className="text-center text-2xl font-semibold text-telivity-navy">{t('propertyScope.title')}</h1>
      <p className="mt-2 text-center text-sm text-telivity-slate">{t('propertyScope.description')}</p>
      {propertiesLoading ? <p role="status" className="mt-5 text-sm text-telivity-slate">{t('propertyScope.loading')}</p>
        : propertiesError ? <div role="alert" className="mt-5 text-sm text-telivity-slate"><p>{t('propertyScope.loadFailed')}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-[44px] rounded-lg border border-gray-200 px-4 py-2">{t('propertyScope.reload')}</button></div>
          : properties.length ? <>
            <label htmlFor="property-search" className="mt-6 block text-sm font-medium text-telivity-navy">{t('propertyScope.search')}</label>
            <div className="relative mt-2">
              <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-telivity-slate" />
              <input ref={searchInput} id="property-search" type="search" value={query} autoComplete="off"
                onChange={event => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }}
                placeholder={t('propertyScope.searchPlaceholder')}
                className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white py-2 ps-10 pe-12 text-base text-telivity-navy placeholder:text-telivity-slate focus:border-telivity-teal focus:outline-none focus:ring-2 focus:ring-telivity-teal/30 sm:text-sm [&::-webkit-search-cancel-button]:appearance-none" />
              {query && <button type="button" onClick={clearSearch} aria-label={t('propertyScope.clearSearch')}
                className="absolute end-0 top-0 flex h-full min-h-[44px] w-11 items-center justify-center rounded-lg text-telivity-slate hover:text-telivity-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-telivity-teal"><X aria-hidden="true" className="h-4 w-4" /></button>}
            </div>
            <p role="status" className="mt-4 text-xs text-telivity-slate">{t('propertyScope.matches', { count: matches.length, formattedCount: new Intl.NumberFormat(i18n.language).format(matches.length) })}</p>
            {matches.length ? <>
              <ul aria-label={t('propertyScope.results')} className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto overscroll-contain border-y border-gray-100">
                {shown.map(({ property }) => <li key={property.id}>
                  <button type="button" onClick={() => setPropertyId(property.id)}
                    aria-label={`${property.name} (${property.code})`}
                    className="flex min-h-[60px] w-full items-center gap-3 px-2 py-3 text-start text-telivity-navy hover:bg-telivity-light-grey focus-visible:bg-telivity-light-grey focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-telivity-teal">
                    <span className="min-w-0 flex-1"><span className="block break-words text-base font-medium sm:text-sm">{property.name}</span><span className="mt-1 block break-words text-xs text-telivity-slate">{property.code}</span></span>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-telivity-slate rtl:rotate-180" />
                  </button>
                </li>)}
              </ul>
              {matches.length > visibleCount && <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-telivity-slate">{t('propertyScope.showing', { shown: shown.length, total: matches.length })}</p>
                <button type="button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)} className="min-h-[44px] rounded-lg px-3 py-2 text-sm font-medium text-telivity-teal hover:bg-telivity-light-grey focus-visible:outline focus-visible:outline-2 focus-visible:outline-telivity-teal">{t('propertyScope.showMore')}</button>
              </div>}
            </> : <div className="py-6 text-center"><p className="text-sm text-telivity-slate">{t('propertyScope.noMatches')}</p><button type="button" onClick={clearSearch} className="mt-2 min-h-[44px] rounded-lg px-3 py-2 text-sm font-medium text-telivity-teal hover:bg-telivity-light-grey focus-visible:outline focus-visible:outline-2 focus-visible:outline-telivity-teal">{t('propertyScope.clearSearch')}</button></div>}
          </> : <p className="mt-5 text-sm text-telivity-slate">{t('propertyScope.empty')}</p>}
    </section>
    </div>
  );
}
