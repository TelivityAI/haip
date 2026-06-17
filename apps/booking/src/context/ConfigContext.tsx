import { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bookingApi } from '../api/client';
import type { Branding, BookingConfig } from '../api/types';

interface ConfigContextValue {
  config?: BookingConfig;
  isLoading: boolean;
  error: unknown;
}

const ConfigContext = createContext<ConfigContextValue>({
  isLoading: true,
  error: null,
});

/** Apply branding to the document via CSS variables (per-property theming). */
export function applyBranding(branding?: Branding | null) {
  if (!branding) return;
  const root = document.documentElement;
  if (branding.primaryColor) root.style.setProperty('--haip-primary', branding.primaryColor);
  if (branding.accentColor) root.style.setProperty('--haip-accent', branding.accentColor);
}

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['config'],
    queryFn: bookingApi.config,
  });

  useEffect(() => {
    if (data) applyBranding(data);
  }, [data]);

  return (
    <ConfigContext.Provider value={{ config: data, isLoading, error }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}
