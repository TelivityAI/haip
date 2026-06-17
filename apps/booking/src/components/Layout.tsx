import { Link } from 'react-router-dom';
import { useConfig } from '../context/ConfigContext';
import { useBookingFlow } from '../context/BookingFlowContext';

export function Layout({ children }: { children: React.ReactNode }) {
  const { config } = useConfig();
  const { branding } = useBookingFlow();
  const displayName =
    branding?.displayName ?? config?.displayName ?? 'Book your stay';

  return (
    <div className="haip-booking min-h-screen bg-gray-50">
      <header
        className="border-b border-gray-200 bg-white"
        style={{ borderTopWidth: 4, borderTopColor: 'var(--haip-primary, #06bdb4)' }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-semibold text-gray-900">
            {displayName}
          </Link>
          <Link
            to="/manage"
            className="text-sm font-medium"
            style={{ color: 'var(--haip-accent, #f2641b)' }}
          >
            Manage booking
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 py-6 text-center text-xs text-gray-400">
        Commission-free direct booking · Powered by HAIP
      </footer>
    </div>
  );
}
