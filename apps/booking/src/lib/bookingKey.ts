/**
 * Resolve the publishable booking key. Priority order:
 *   1. `?key=` URL query param
 *   2. `data-booking-key` attribute on the mount element / current <script>
 *   3. `VITE_BOOKING_KEY` build-time env
 *   4. The well-known demo key (local / demo only)
 *
 * The key is publishable (it ships in the hotel's HTML), so reading it from the
 * page is by design. The server derives the property from the key — the widget
 * never sends a propertyId.
 */

export const DEMO_BOOKING_KEY = 'pk_live_HAIPDEMO0000000000000000';

export function resolveBookingKey(mountEl?: Element | null): string {
  // 1. URL query param
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('key');
    if (fromUrl) return fromUrl;
  } catch {
    // window may be unavailable in non-browser contexts
  }

  // 2. data-booking-key on the mount element, or on the currently-running script
  const fromMount = mountEl?.getAttribute?.('data-booking-key');
  if (fromMount) return fromMount;

  const current = document.currentScript as HTMLScriptElement | null;
  const fromScript = current?.getAttribute('data-booking-key');
  if (fromScript) return fromScript;

  const tagged = document.querySelector('[data-booking-key]');
  const fromAnyEl = tagged?.getAttribute('data-booking-key');
  if (fromAnyEl) return fromAnyEl;

  // 3. env
  const fromEnv = import.meta.env.VITE_BOOKING_KEY;
  if (fromEnv) return fromEnv;

  // 4. demo fallback
  return DEMO_BOOKING_KEY;
}
