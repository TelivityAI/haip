import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { setBookingKey } from './api/client';
import { resolveBookingKey } from './lib/bookingKey';
import { ConfigProvider } from './context/ConfigContext';
import { BookingFlowProvider } from './context/BookingFlowContext';
import App from './App';
import './index.css';

/**
 * Mount the booking widget into a host element. Shared by the standalone SPA
 * (main.tsx) and the embed script (embed.ts).
 *
 * Uses MemoryRouter so routing is self-contained and never touches the host
 * page's URL/history — safe inside any embedding site.
 */
export function mountBooking(el: Element) {
  // The key may be carried on the mount element via data-booking-key.
  setBookingKey(resolveBookingKey(el));

  // Ensure the Tailwind important-scope class is present on the container.
  el.classList.add('haip-booking');

  createRoot(el).render(
    <StrictMode>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider>
            <BookingFlowProvider>
              <App />
            </BookingFlowProvider>
          </ConfigProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}
