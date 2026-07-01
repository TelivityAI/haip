import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, setPropertyId as setApiPropertyId } from '../lib/api';
import { joinPropertyRoom, leavePropertyRoom } from '../lib/socket';

export interface PropertySummary {
  id: string;
  name: string;
  code: string;
}

interface PropertyContextValue {
  propertyId: string | null;
  setPropertyId: (id: string) => void;
  properties: PropertySummary[];
  propertiesLoading: boolean;
  propertiesError: string | null;
}

const PropertyContext = createContext<PropertyContextValue>({
  propertyId: null,
  setPropertyId: () => {},
  properties: [],
  propertiesLoading: false,
  propertiesError: null,
});

export function PropertyProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [propertyId, setPropertyIdState] = useState<string | null>(
    searchParams.get('propertyId'),
  );
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);

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
    api
      .get('/v1/properties')
      .then((res) => {
        const list: PropertySummary[] = res.data?.data ?? res.data ?? [];
        setProperties(list);
        if (!propertyId && list.length > 0) {
          setPropertyId(list[0].id);
        }
      })
      .catch((err) => {
        setPropertiesError(err?.message ?? 'Failed to load properties');
      })
      .finally(() => setPropertiesLoading(false));
    // Bootstrap once; propertyId auto-select handled inside the effect.
  }, []);

  useEffect(() => {
    setApiPropertyId(propertyId);
    if (propertyId) {
      joinPropertyRoom(propertyId);
      return () => leavePropertyRoom(propertyId);
    }
  }, [propertyId]);

  return (
    <PropertyContext.Provider
      value={{ propertyId, setPropertyId, properties, propertiesLoading, propertiesError }}
    >
      {children}
    </PropertyContext.Provider>
  );
}

export function useProperty() {
  return useContext(PropertyContext);
}
