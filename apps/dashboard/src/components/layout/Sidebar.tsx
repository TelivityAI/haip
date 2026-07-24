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
  Plug,
  Mail,
  MessageSquare,
  Settings,
  ShieldCheck,
  Upload,
  UsersRound,
  Briefcase,
  Banknote,
  Building2,
  Calculator,
  ReceiptText,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useProperty } from '../../context/PropertyContext';

type NavItem = {
  to: string;
  icon: typeof LayoutDashboard;
  labelKey: string;
  permission?: string;
  roles?: string[];
};

type NavSection = {
  sectionKey?: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard', permission: 'dashboard.view' },
      { to: '/front-desk', icon: ConciergeBell, labelKey: 'nav.frontDesk', permission: 'frontdesk.access' },
      { to: '/reservations', icon: CalendarDays, labelKey: 'nav.reservations', permission: 'reservations.read' },
      { to: '/guests', icon: Users, labelKey: 'nav.guests', permission: 'guests.read' },
      { to: '/rooms', icon: DoorOpen, labelKey: 'nav.rooms', permission: 'rooms.read' },
      { to: '/housekeeping', icon: Sparkles, labelKey: 'nav.housekeeping', permission: 'housekeeping.read' },
      { to: '/folios', icon: Receipt, labelKey: 'nav.foliosBilling', permission: 'folios.read' },
    ],
  },
  {
    sectionKey: 'nav.backOffice',
    items: [
      { to: '/groups', icon: UsersRound, labelKey: 'nav.groups', permission: 'groups.read' },
      { to: '/commercial', icon: Briefcase, labelKey: 'nav.commercial', permission: 'commercial.read' },
      { to: '/cashier', icon: Banknote, labelKey: 'nav.cashier', permission: 'cashier.access' },
      { to: '/house-accounts', icon: Building2, labelKey: 'nav.houseAccounts', permission: 'houseaccounts.read' },
      { to: '/accounting', icon: Calculator, labelKey: 'nav.accounting', permission: 'accounting.view' },
      { to: '/tax', icon: ReceiptText, labelKey: 'nav.tax', permission: 'tax.manage' },
    ],
  },
  {
    items: [
      { to: '/rate-plans', icon: BadgeDollarSign, labelKey: 'nav.ratePlans', permission: 'rateplans.read' },
      { to: '/revenue', icon: TrendingUp, labelKey: 'nav.revenueManagement', permission: 'revenue.manage' },
      { to: '/night-audit', icon: Moon, labelKey: 'nav.nightAudit', permission: 'nightaudit.run' },
      { to: '/reports', icon: BarChart3, labelKey: 'nav.reports', permission: 'reports.view' },
      { to: '/channels', icon: Radio, labelKey: 'nav.channels', permission: 'channels.manage' },
      { to: '/integrations', icon: Plug, labelKey: 'nav.integrations', permission: 'settings.manage' },
      { to: '/communications', icon: Mail, labelKey: 'nav.communications', permission: 'communications.manage' },
      { to: '/reviews', icon: MessageSquare, labelKey: 'nav.reviews', permission: 'reviews.manage' },
      { to: '/settings?tab=users', icon: ShieldCheck, labelKey: 'nav.usersRoles', permission: 'admin.users.manage' },
      { to: '/import', icon: Upload, labelKey: 'nav.import', permission: 'settings.manage' },
      { to: '/settings', icon: Settings, labelKey: 'nav.settings', permission: 'settings.manage' },
    ],
  },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

function isItemVisible(
  item: NavItem,
  hasPermission: (key: string) => boolean,
  hasRole: (...roles: string[]) => boolean,
) {
  if (item.permission) return hasPermission(item.permission);
  if (item.roles) return hasRole(...item.roles);
  return true;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { hasRole, hasPermission } = useAuth();
  const { t } = useTranslation();
  const { propertyId, isPortfolioMode, properties } = useProperty();

  const activeProperty = isPortfolioMode
    ? null
    : properties.find((p) => p.id === propertyId);

  const brandName = isPortfolioMode
    ? 'HAIP'
    : (activeProperty?.staffDisplayName || activeProperty?.name || 'HAIP');
  const brandLogo = !isPortfolioMode ? activeProperty?.staffLogoUrl : null;
  const tagline = isPortfolioMode
    ? t('header.allProperties', { defaultValue: 'All Properties' })
    : t('nav.tagline');

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isItemVisible(item, hasPermission, hasRole)),
  })).filter((section) => section.items.length > 0);

  return (
    <>
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
        style={
          !isPortfolioMode && activeProperty?.staffPrimaryColor
            ? { backgroundColor: activeProperty.staffPrimaryColor }
            : undefined
        }
      >
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {brandLogo ? (
              <img src={brandLogo} alt="" className="h-8 w-8 rounded object-cover flex-shrink-0 bg-white/10" />
            ) : null}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-wide truncate">{brandName}</h1>
              <p className="text-xs text-white/60 mt-0.5 truncate">{tagline}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded hover:bg-white/10 flex-shrink-0"
            aria-label={t('nav.closeMenu')}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3" role="navigation" aria-label={t('nav.mainNavigation')}>
          {visibleSections.map((section, sectionIdx) => (
            <div key={section.sectionKey ?? `section-${sectionIdx}`}>
              {section.sectionKey && (
                <p className="px-6 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  {t(section.sectionKey)}
                </p>
              )}
              {section.items.map(({ to, icon: Icon, labelKey }) => (
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
            </div>
          ))}
        </nav>

        <div className="px-6 py-4 border-t border-white/10 text-xs text-telivity-mid-grey">
          v0.1.0
        </div>
      </aside>
    </>
  );
}
