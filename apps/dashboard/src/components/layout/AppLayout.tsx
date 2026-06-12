import { useState, useEffect, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuth } from '../../context/AuthContext';
import { useProperty } from '../../context/PropertyContext';
import { useMyPermissions } from '../../hooks/useAdmin';

export default function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { authEnabled, setPermissions } = useAuth();
  const { propertyId } = useProperty();

  // Under real auth, resolve the current user's effective permissions for the
  // active property and feed them into AuthContext (drives nav/feature gating).
  // When auth is disabled (demo), hasPermission already returns true.
  const { data } = useMyPermissions(propertyId, authEnabled);
  useEffect(() => {
    if (data?.permissions) setPermissions(data.permissions);
  }, [data, setPermissions]);

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
