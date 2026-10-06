import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProperty } from '../../context/PropertyContext';

/** Only these views implement aggregation or individually scoped reads.
 * A portfolio is a UI selection, never an API tenant identifier. */
export function supportsPortfolio(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === '/' || path === '/reports' || path.startsWith('/reports/')
    || path === '/channels';
}

export default function PropertyScopeBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { propertyId, isPortfolioMode, properties, propertiesLoading, propertiesError, setPropertyId } = useProperty();

  if (propertyId && (!isPortfolioMode || supportsPortfolio(pathname))) return children;

  return (
    <section aria-labelledby="property-scope-title" className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6">
      <h1 id="property-scope-title" className="text-2xl font-semibold text-telivity-navy">{t('propertyScope.title')}</h1>
      <p className="mt-3 text-sm text-telivity-slate">{t('propertyScope.description')}</p>
      {propertiesLoading ? <p role="status" className="mt-5 text-sm text-telivity-slate">{t('propertyScope.loading')}</p>
        : propertiesError ? <div role="alert" className="mt-5 text-sm text-telivity-slate"><p>{t('propertyScope.loadFailed')}</p><button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-[44px] rounded-lg border border-gray-200 px-4 py-2">{t('propertyScope.reload')}</button></div>
          : properties.length ? <ul className="mt-5 grid gap-3 sm:grid-cols-2">{properties.map(property => (
            <li key={property.id}><button type="button" onClick={() => setPropertyId(property.id)} className="min-h-[44px] w-full break-words rounded-lg border border-gray-200 px-4 py-3 text-left text-sm font-medium text-telivity-navy hover:border-telivity-teal hover:bg-telivity-light-grey">{property.name}</button></li>
          ))}</ul> : <p className="mt-5 text-sm text-telivity-slate">{t('propertyScope.empty')}</p>}
    </section>
  );
}
