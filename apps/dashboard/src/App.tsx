import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { SkeletonPage } from './components/ui/Skeleton';
import { useRealtimeInvalidation } from './hooks/useRealtimeInvalidation';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const FrontDesk = lazy(() => import('./pages/FrontDesk'));
const Reservations = lazy(() => import('./pages/Reservations'));
const Guests = lazy(() => import('./pages/Guests'));
const Rooms = lazy(() => import('./pages/Rooms'));
const Housekeeping = lazy(() => import('./pages/Housekeeping'));
const Folios = lazy(() => import('./pages/Folios'));
const RatePlans = lazy(() => import('./pages/RatePlans'));
const Revenue = lazy(() => import('./pages/Revenue'));
const NightAudit = lazy(() => import('./pages/NightAudit'));
const Reports = lazy(() => import('./pages/Reports'));
const Channels = lazy(() => import('./pages/Channels'));
const Communications = lazy(() => import('./pages/Communications'));
const Reviews = lazy(() => import('./pages/Reviews'));
const Settings = lazy(() => import('./pages/Settings'));
const Import = lazy(() => import('./pages/Import'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Groups = lazy(() => import('./pages/Groups'));
const Commercial = lazy(() => import('./pages/Commercial'));
const Cashier = lazy(() => import('./pages/Cashier'));
const HouseAccounts = lazy(() => import('./pages/HouseAccounts'));
const Accounting = lazy(() => import('./pages/Accounting'));
const TaxSettings = lazy(() => import('./pages/TaxSettings'));

export default function App() {
  useRealtimeInvalidation();

  return (
    <AppLayout>
      <ErrorBoundary>
        <Suspense fallback={<SkeletonPage />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/front-desk" element={<FrontDesk />} />
            <Route path="/reservations/*" element={<Reservations />} />
            <Route path="/guests/*" element={<Guests />} />
            <Route path="/rooms/*" element={<Rooms />} />
            <Route path="/housekeeping/*" element={<Housekeeping />} />
            <Route path="/folios/*" element={<Folios />} />
            <Route path="/groups/*" element={<Groups />} />
            <Route path="/commercial/*" element={<Commercial />} />
            <Route path="/cashier/*" element={<Cashier />} />
            <Route path="/house-accounts/*" element={<HouseAccounts />} />
            <Route path="/accounting/*" element={<Accounting />} />
            <Route path="/tax/*" element={<TaxSettings />} />
            <Route path="/rate-plans/*" element={<RatePlans />} />
            <Route path="/revenue/*" element={<Revenue />} />
            <Route path="/night-audit" element={<NightAudit />} />
            <Route path="/reports/*" element={<Reports />} />
            <Route path="/channels/*" element={<Channels />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/communications" element={<Communications />} />
            <Route path="/reviews" element={<Reviews />} />
            <Route path="/settings/*" element={<Settings />} />
            <Route path="/import" element={<Import />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppLayout>
  );
}
