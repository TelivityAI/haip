import { Link, useLocation } from 'react-router-dom';
import { useConfig } from '../context/ConfigContext';
import { useBookingFlow } from '../context/BookingFlowContext';

export function Layout({ children }: { children: React.ReactNode }) {
  const { config } = useConfig();
  const { branding, requestSubmissionStatus } = useBookingFlow();
  const { pathname } = useLocation();
  const isRequestFlow = pathname.startsWith('/request/');
  const displayName =
    branding?.displayName ?? config?.displayName ?? 'Book your stay';

  return (
    <div className="haip-booking min-h-screen bg-gray-50">
      <header
        className="border-b border-gray-200 bg-white"
        style={{ borderTopWidth: 4, borderTopColor: 'var(--haip-primary, #06bdb4)' }}
      >
        <div className={`mx-auto flex items-center justify-between px-4 py-4 ${isRequestFlow ? 'max-w-5xl' : 'max-w-3xl'}`}>
          <Link
            to="/"
            className="text-lg font-semibold text-gray-900"
            aria-disabled={requestSubmissionStatus === 'pending'}
            tabIndex={requestSubmissionStatus === 'pending' ? -1 : undefined}
            onClick={(event) => {
              if (requestSubmissionStatus === 'pending') event.preventDefault();
            }}
          >
            {displayName}
          </Link>
          {!isRequestFlow && (
            <Link
              to="/manage"
              className="text-sm font-medium"
              style={{ color: 'var(--haip-accent, #f2641b)' }}
            >
              Manage booking
            </Link>
          )}
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${isRequestFlow ? 'max-w-5xl' : 'max-w-3xl'}`}>{children}</main>
      <footer className={`mx-auto px-4 py-6 text-center text-xs text-gray-400 ${isRequestFlow ? 'max-w-5xl' : 'max-w-3xl'}`}>
        Commission-free direct booking · Powered by HAIP
      </footer>
    </div>
  );
}
