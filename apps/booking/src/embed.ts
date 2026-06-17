import { mountBooking } from './mount';

/**
 * Embed entry point. A host page includes:
 *
 *   <div id="haip-booking" data-booking-key="pk_live_..."></div>
 *   <script src="/booking/embed.js"></script>
 *
 * This script finds the target container and mounts the React widget into it.
 * It mounts on DOMContentLoaded (or immediately if the DOM is already ready),
 * so the snippet works whether the script is in <head> or at end of <body>.
 */
function init() {
  const el =
    document.getElementById('haip-booking') ??
    document.querySelector('[data-booking-key]');
  if (el) mountBooking(el);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
