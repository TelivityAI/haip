/**
 * Staff dashboard help copy — short UI guidance for each route.
 * Keep entries generic and suitable for an open-source product.
 */

export interface HelpEntry {
  route: string;
  title: string;
  summary: string;
  bullets: string[];
  related?: Array<{ label: string; href: string }>;
}

const HELP: HelpEntry[] = [
  {
    route: '/',
    title: 'Dashboard',
    summary: 'Live snapshot of occupancy, rates, revenue, and today’s front-desk activity for the selected property—or a portfolio rollup across hotels.',
    bullets: [
      'KPI tiles show occupancy, ADR, RevPAR, and today’s revenue from reports.',
      'Use All Properties in the header to compare hotels side by side.',
      'The activity feed updates in real time when WebSocket is connected.',
    ],
    related: [
      { label: 'Reports', href: '/reports' },
      { label: 'Front Desk', href: '/front-desk' },
    ],
  },
  {
    route: '/front-desk',
    title: 'Front Desk',
    summary: 'Arrivals, in-house guests, and departures for the current business day.',
    bullets: [
      'Work arrivals and departures from the tab list for the selected property.',
      'Open a reservation from the list to assign rooms or continue check-in.',
    ],
    related: [{ label: 'Reservations', href: '/reservations' }],
  },
  {
    route: '/reservations',
    title: 'Reservations',
    summary: 'Create and manage bookings, calendar views, and room assignments.',
    bullets: [
      'Search availability before creating a new reservation.',
      'Use the calendar to see occupancy across dates.',
    ],
  },
  {
    route: '/guests',
    title: 'Guests',
    summary: 'Guest profiles linked to stays at this property.',
    bullets: [
      'Search by name, email, or phone.',
      'Profiles are shared across properties, but access is scoped to guests who stayed here.',
    ],
  },
  {
    route: '/rooms',
    title: 'Rooms',
    summary: 'Inventory, room types, and housekeeping status for physical rooms.',
    bullets: [
      'Update room status as rooms turn or go out of order.',
      'Manage room type capacity under the Types view.',
    ],
  },
  {
    route: '/housekeeping',
    title: 'Housekeeping',
    summary: 'Task list and room readiness for the operations team.',
    bullets: [
      'Assign and complete cleaning tasks for check-outs and stayovers.',
      'Use the dashboard tab for a quick readiness overview.',
    ],
  },
  {
    route: '/folios',
    title: 'Folios & Billing',
    summary: 'Guest folios, charges, and settlement balances.',
    bullets: [
      'Open a folio to post charges or record payments.',
      'Balances should be settled before checkout where possible.',
    ],
    related: [{ label: 'Accounting', href: '/accounting' }],
  },
  {
    route: '/night-audit',
    title: 'Night Audit',
    summary: 'Close the business day: post room tariffs, process no-shows, and finalize the audit run.',
    bullets: [
      'Run night audit once per business date; completed dates cannot be re-run.',
      'Review the summary and any errors before relying on day-end numbers.',
      'Completed audits can trigger accounting export webhooks for your books.',
    ],
    related: [{ label: 'Reports', href: '/reports' }],
  },
  {
    route: '/reports',
    title: 'Reports',
    summary: 'Operational reports for revenue, occupancy, and trends.',
    bullets: [
      'Pick a report type and date (or range for occupancy trend).',
      'Star reports to keep favorites at the top of the selector.',
      'In portfolio mode, financial summary and occupancy roll up across hotels.',
    ],
  },
  {
    route: '/revenue',
    title: 'Revenue Management',
    summary: 'AI agents for pricing, demand, overbooking, and related recommendations.',
    bullets: [
      'Review pending decisions before approving autopilot actions.',
      'HAIP AI explanations annotate numeric recommendations; they do not change inventory themselves.',
    ],
  },
  {
    route: '/accounting',
    title: 'Accounting',
    summary: 'Deposits, city ledger A/R, and CSV exports for your external books.',
    bullets: [
      'Download the revenue journal or folio ledger trial balance for a business date.',
      'The trial balance covers Deposit, Guest, and A/R ledgers—not a full general ledger.',
    ],
  },
  {
    route: '/settings',
    title: 'Settings',
    summary: 'Property details, users & roles, webhooks, and booking engine config.',
    bullets: [
      'Staff branding (logo and colors) is set on the Property tab for the dashboard shell.',
      'Guest-facing booking branding is configured separately under Booking Engine.',
      'KPI warn thresholds live under Property settings.',
    ],
  },
  {
    route: '/channels',
    title: 'Channels',
    summary: 'Channel manager connections and rate parity monitoring.',
    bullets: [
      'Connect OTAs and review sync status from this page.',
    ],
  },
  {
    route: '/groups',
    title: 'Groups',
    summary: 'Group profiles, allotment blocks, and rooming lists.',
    bullets: [
      'Create a group profile before building allotment blocks.',
    ],
  },
  {
    route: '/cashier',
    title: 'Cashier',
    summary: 'Cash drawer sessions and cash movements for the shift.',
    bullets: [
      'Open a drawer session before recording cash payments.',
      'Close and report the session at end of shift.',
    ],
  },
];

const byRoute = new Map(HELP.map((h) => [h.route, h]));

/** Normalize a pathname to the nearest help key (strip IDs / wildcards). */
export function normalizeHelpRoute(pathname: string): string {
  const path = (pathname.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (byRoute.has(path)) return path;
  // Match longest known prefix (e.g. /reservations/calendar → /reservations)
  const prefixes = [...byRoute.keys()]
    .filter((k) => k !== '/' && path.startsWith(k))
    .sort((a, b) => b.length - a.length);
  return prefixes[0] ?? path;
}

export function getHelpForRoute(pathname: string): HelpEntry | null {
  const key = normalizeHelpRoute(pathname);
  return byRoute.get(key) ?? null;
}

export function listHelpRoutes(): string[] {
  return HELP.map((h) => h.route);
}
