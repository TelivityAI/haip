import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, User, X, CheckCircle2, ShieldCheck } from 'lucide-react';
import { checkFnrhComplete } from '@telivityhaip/shared';
import { api } from '../../lib/api';
import { useProperty } from '../../context/PropertyContext';
import CreateGuestModal from './CreateGuestModal';
import type { Guest } from '../../types/guest';

export interface FindGuestProps {
  selectedGuest: Guest | null;
  onSelectGuest: (guest: Guest | null) => void;
  placeholder?: string;
  label?: string;
}

export default function FindGuest({
  selectedGuest,
  onSelectGuest,
  placeholder,
  label,
}: FindGuestProps) {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const [searchTerm, setSearchTerm] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['guests', 'find', propertyId, searchTerm],
    queryFn: () =>
      api
        .get('/v1/guests', {
          params: {
            propertyId,
            search: searchTerm.trim() || undefined,
            limit: 20,
          },
        })
        .then((r) => r.data),
    enabled: !!propertyId && dropdownOpen,
  });

  const guests: Guest[] = data?.data ?? data ?? [];

  return (
    <div className="w-full relative" ref={containerRef}>
      {label && (
        <label className="block text-xs font-medium text-telivity-mid-grey mb-1">
          {label}
        </label>
      )}

      {selectedGuest ? (
        // SELECTED GUEST CARD
        <div className="flex items-center justify-between p-3 bg-telivity-teal/5 border border-telivity-teal/20 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-telivity-teal/10 flex items-center justify-center text-telivity-teal font-bold text-sm">
              <User size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-telivity-navy">
                  {selectedGuest.firstName} {selectedGuest.lastName}
                </span>
                {checkFnrhComplete(selectedGuest) && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                    <ShieldCheck size={11} /> FNRH
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-telivity-mid-grey">
                {selectedGuest.email && <span>{selectedGuest.email}</span>}
                {selectedGuest.phone && <span>• {selectedGuest.phone}</span>}
                {selectedGuest.taxId && <span>• Doc: {selectedGuest.taxId}</span>}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectGuest(null)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title={t('guests.changeGuest')}
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        // SEARCH COMBOBOX INPUT
        <div className="relative">
          <div className="relative flex items-center">
            <Search
              size={16}
              className="absolute left-3 text-telivity-mid-grey pointer-events-none"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setDropdownOpen(true);
              }}
              onFocus={() => setDropdownOpen(true)}
              placeholder={placeholder || t('guests.searchOrRegister')}
              className="w-full border border-gray-200 rounded-lg pl-9 pr-24 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white"
            />
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="absolute right-1.5 flex items-center gap-1 bg-telivity-teal/10 hover:bg-telivity-teal text-telivity-teal hover:text-white px-2.5 py-1 rounded-md text-xs font-semibold transition-colors"
            >
              <Plus size={14} /> {t('guests.quickCreate')}
            </button>
          </div>

          {/* DROPDOWN MENU */}
          {dropdownOpen && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-gray-100">
              {isFetching && guests.length === 0 ? (
                <div className="p-3 text-xs text-center text-telivity-mid-grey">
                  {t('common.loading')}
                </div>
              ) : guests.length > 0 ? (
                guests.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      onSelectGuest(g);
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left p-3 hover:bg-telivity-teal/5 flex items-center justify-between group transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-telivity-navy group-hover:text-telivity-teal">
                          {g.firstName} {g.lastName}
                        </span>
                        {checkFnrhComplete(g) && (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                            FNRH
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-telivity-mid-grey flex items-center gap-2 mt-0.5">
                        {g.email && <span>{g.email}</span>}
                        {g.phone && <span>• {g.phone}</span>}
                        {g.taxId && <span>• {g.taxId}</span>}
                      </div>
                    </div>
                    <CheckCircle2
                      size={16}
                      className="text-telivity-teal opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </button>
                ))
              ) : (
                <div className="p-4 text-center space-y-2">
                  <p className="text-xs text-telivity-mid-grey">
                    {t('guests.noResultsCreate')}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  setCreateModalOpen(true);
                }}
                className="w-full p-2.5 bg-gray-50 hover:bg-telivity-teal/10 text-telivity-teal text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border-t border-gray-100"
              >
                <Plus size={14} /> {t('guests.newGuest')}
              </button>
            </div>
          )}
        </div>
      )}

      <CreateGuestModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        initialSearchTerm={searchTerm}
        onSuccess={(newGuest) => {
          onSelectGuest(newGuest);
          setCreateModalOpen(false);
          setDropdownOpen(false);
        }}
      />
    </div>
  );
}
