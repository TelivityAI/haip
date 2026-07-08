import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, setPropertyId as setApiPropertyId } from '../lib/api';
import { joinPropertyRoom, leavePropertyRoom } from '../lib/socket';
import {
  PORTFOLIO_MODE_ID,
  type PropertySummary,
  type OrganizationSummary,
} from '../lib/property-types';

interface PropertyContextValue {
  propertyId: string | null;
  setPropertyId: (id: string) => void;
  isPortfolioMode: boolean;
  properties: PropertySummary[];
  organizations: OrganizationSummary[];
  propertiesLoading: boolean;
  propertiesError: string | null;
}

const PropertyContext = createContext<PropertyContextValue>({
  propertyId: null,
  setPropertyId: () => {},
  isPortfolioMode: false,
  properties: [],
  organizations: [],
  propertiesLoading: false,
  propertiesError: null,
});

export function PropertyProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [propertyId, setPropertyIdState] = useState<string | null>(
    searchParams.get('propertyId'),
  );
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);

  const isPortfolioMode = propertyId === PORTFOLIO_MODE_ID;

  function setPropertyId(id: string) {
    setPropertyIdState(id);
    setSearchParams((prev) => {
      prev.set('propertyId', id);
      return prev;
    });
  }

  useEffect(() => {
    setPropertiesLoading(true);
    setPropertiesError(null);
    Promise.all([
      api.get('/v1/properties'),
      api.get('/v1/organizations').catch(() => ({ data: [] })),
    ])
      .then(([propRes, orgRes]) => {
        const list: PropertySummary[] = propRes.data?.data ?? propRes.data ?? [];
        const orgList: OrganizationSummary[] = orgRes.data?.data ?? orgRes.data ?? [];
        setProperties(list);
        setOrganizations(orgList);
        if (!propertyId && list.length > 0) {
          // Default to portfolio when user has multiple properties
          setPropertyId(list.length > 1 ? PORTFOLIO_MODE_ID : list[0].id);
        }
      })
      .catch((err) => {
        setPropertiesError(err?.message ?? 'Failed to load properties');
      })
      .finally(() => setPropertiesLoading(false));
    // Bootstrap once; propertyId auto-select handled inside the effect.
  }, []);

  useEffect(() => {
    if (isPortfolioMode) {
      setApiPropertyId(null);
      return;
    }
    setApiPropertyId(propertyId);
    if (propertyId) {
      joinPropertyRoom(propertyId);
      return () => leavePropertyRoom(propertyId);
    }
  }, [propertyId, isPortfolioMode]);

  return (
    <PropertyContext.Provider
      value={{
        propertyId,
        setPropertyId,
        isPortfolioMode,
        properties,
        organizations,
        propertiesLoading,
        propertiesError,
      }}
    >
      {children}
    </PropertyContext.Provider>
  );
}

export function useProperty() {
  return useContext(PropertyContext);
}

export { PORTFOLIO_MODE_ID };
