import { useState, useEffect, type ReactNode, useMemo } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuth } from '../../context/AuthContext';
import { useProperty } from '../../context/PropertyContext';
import { useMyPermissions } from '../../hooks/useAdmin';

export default function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { authEnabled, setPermissions } = useAuth();
  const { propertyId, isPortfolioMode, properties } = useProperty();

  const permissionsPropertyId =
    isPortfolioMode ? (properties[0]?.id ?? null) : propertyId;

  const { data } = useMyPermissions(permissionsPropertyId, authEnabled);
  useEffect(() => {
    if (data?.permissions) setPermissions(data.permissions);
  }, [data, setPermissions]);

  const activeProperty = useMemo(
    () => (isPortfolioMode ? null : properties.find((p) => p.id === propertyId) ?? null),
    [isPortfolioMode, properties, propertyId],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (activeProperty?.staffPrimaryColor) {
      root.style.setProperty('--staff-primary', activeProperty.staffPrimaryColor);
    } else {
      root.style.removeProperty('--staff-primary');
    }
    if (activeProperty?.staffAccentColor) {
      root.style.setProperty('--staff-accent', activeProperty.staffAccentColor);
    } else {
      root.style.removeProperty('--staff-accent');
    }
  }, [activeProperty?.staffPrimaryColor, activeProperty?.staffAccentColor]);

  return (
    <div className="min-h-screen bg-telivity-light-grey">
      <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:ml-60">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
