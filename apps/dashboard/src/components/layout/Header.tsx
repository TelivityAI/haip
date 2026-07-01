import { useState } from 'react';
import { Bell, ChevronDown, Menu, LogOut, User, Languages } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useProperty } from '../../context/PropertyContext';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import { SUPPORTED_LANGUAGES } from '../../i18n';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const { propertyId, setPropertyId, properties } = useProperty();
  const { user, roles, authEnabled, logout } = useAuth();
  const { connected } = useSocket();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const activeProperty = properties.find((p) => p.id === propertyId);
  const currentLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ??
    SUPPORTED_LANGUAGES[0];

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-3 sm:px-6">
      <div className="flex items-center gap-2 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-telivity-light-grey"
          aria-label={t('header.openMenu')}
        >
          <Menu size={20} className="text-telivity-slate" />
        </button>

        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-telivity-teal text-sm font-medium transition-colors"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className="truncate max-w-[140px] sm:max-w-none">{activeProperty?.name ?? t('header.selectProperty')}</span>
            <ChevronDown size={14} />
          </button>
          {open && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1" role="listbox">
              {properties.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setPropertyId(p.id); setOpen(false); }}
                  role="option"
                  aria-selected={p.id === propertyId}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-telivity-light-grey transition-colors ${
                    p.id === propertyId ? 'text-telivity-teal font-semibold' : ''
                  }`}
                >
                  {p.name}
                  <span className="text-telivity-mid-grey ml-2">({p.code})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="text-sm text-telivity-mid-grey hidden sm:inline">
          {format(new Date(), 'EEEE, MMM d, yyyy')}
        </span>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-telivity-dark-teal' : 'bg-telivity-orange'}`} aria-hidden="true" />
          <span className="text-xs text-telivity-mid-grey">{connected ? t('header.statusLive') : t('header.statusOffline')}</span>
        </div>

        {/* Language switcher */}
        <div className="relative">
          <button
            onClick={() => setLangOpen(!langOpen)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-telivity-light-grey text-xs font-medium text-telivity-slate transition-colors"
            aria-haspopup="listbox"
            aria-expanded={langOpen}
            aria-label={t('header.language')}
            title={t('header.language')}
          >
            <Languages size={16} className="text-telivity-slate" />
            <span className="uppercase">{currentLang.code}</span>
            <ChevronDown size={12} />
          </button>
          {langOpen && (
            <div className="absolute top-full right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1" role="listbox">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => { i18n.changeLanguage(lang.code); setLangOpen(false); }}
                  role="option"
                  aria-selected={lang.code === currentLang.code}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-telivity-light-grey transition-colors ${
                    lang.code === currentLang.code ? 'text-telivity-teal font-semibold' : ''
                  }`}
                >
                  {lang.label}
                  <span className="text-telivity-mid-grey ml-2 uppercase">({lang.code})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="relative p-2 rounded-lg hover:bg-telivity-light-grey transition-colors" aria-label={t('header.notifications')}>
          <Bell size={18} className="text-telivity-slate" />
        </button>

        {authEnabled && user && (
          <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-200">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-medium text-telivity-slate">{user.name || user.email}</p>
              <p className="text-[10px] text-telivity-mid-grey capitalize">
                {roles.filter(r => !r.startsWith('default-')).join(', ') || t('header.user')}
              </p>
            </div>
            <User size={16} className="sm:hidden text-telivity-slate" />
            <button
              onClick={logout}
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
              aria-label={t('header.logout')}
              title={t('header.logout')}
            >
              <LogOut size={16} className="text-telivity-mid-grey hover:text-red-600" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
