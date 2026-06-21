import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ConciergeBell,
  CalendarDays,
  Users,
  DoorOpen,
  Sparkles,
  Receipt,
  BadgeDollarSign,
  TrendingUp,
  Moon,
  BarChart3,
  Radio,
  Mail,
  MessageSquare,
  Settings,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

/**
 * Nav items gated by permission (preferred) with a role fallback.
 * - If `permission` is set, the item shows when the user has that permission.
 * - Else if `roles` is set, the item shows when the user has a matching role.
 * - Else the item is always visible.
 * When auth is disabled (demo), both hasPermission and hasRole return true.
 * `labelKey` is an i18n key resolved via t() at render — see src/locales/.
 */
const NAV_ITEMS: Array<{
  to: string;
  icon: typeof LayoutDashboard;
  labelKey: string;
  permission?: string;
  roles?: string[];
}> = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', permission: 'dashboard.view' },
  { to: '/front-desk', icon: ConciergeBell, labelKey: 'nav.frontDesk', permission: 'frontdesk.access' },
  { to: '/reservations', icon: CalendarDays, labelKey: 'nav.reservations', permission: 'reservations.read' },
  { to: '/guests', icon: Users, labelKey: 'nav.guests', permission: 'guests.read' },
  { to: '/rooms', icon: DoorOpen, labelKey: 'nav.rooms', permission: 'rooms.read' },
  { to: '/housekeeping', icon: Sparkles, labelKey: 'nav.housekeeping', permission: 'housekeeping.read' },
  { to: '/folios', icon: Receipt, labelKey: 'nav.foliosBilling', permission: 'folios.read' },
  { to: '/rate-plans', icon: BadgeDollarSign, labelKey: 'nav.ratePlans', permission: 'rateplans.read' },
  { to: '/revenue', icon: TrendingUp, labelKey: 'nav.revenueManagement', permission: 'revenue.manage' },
  { to: '/night-audit', icon: Moon, labelKey: 'nav.nightAudit', permission: 'nightaudit.run' },
  { to: '/reports', icon: BarChart3, labelKey: 'nav.reports', permission: 'reports.view' },
  { to: '/channels', icon: Radio, labelKey: 'nav.channels', permission: 'channels.manage' },
  { to: '/communications', icon: Mail, labelKey: 'nav.communications', permission: 'communications.manage' },
  { to: '/reviews', icon: MessageSquare, labelKey: 'nav.reviews', permission: 'reviews.manage' },
  { to: '/settings?tab=users', icon: ShieldCheck, labelKey: 'nav.usersRoles', permission: 'admin.users.manage' },
  { to: '/import', icon: Upload, labelKey: 'nav.import', permission: 'settings.manage' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings', permission: 'settings.manage' },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { hasRole, hasPermission } = useAuth();
  const { t } = useTranslation();

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.permission
      ? hasPermission(item.permission)
      : !item.roles || hasRole(...item.roles),
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          w-60 bg-telivity-navy text-white flex flex-col h-screen fixed left-0 top-0 z-50
          transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-wide">HAIP</h1>
            <p className="text-xs text-telivity-mid-grey mt-0.5">{t('nav.tagline')}</p>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded hover:bg-white/10"
            aria-label={t('nav.closeMenu')}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3" role="navigation" aria-label={t('nav.mainNavigation')}>
          {visibleItems.map(({ to, icon: Icon, labelKey }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-telivity-teal/15 text-telivity-teal border-r-3 border-telivity-teal'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <Icon size={18} aria-hidden="true" />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="px-6 py-4 border-t border-white/10 text-xs text-telivity-mid-grey">
          v0.1.0
        </div>
      </aside>
    </>
  );
}
