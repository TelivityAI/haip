import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useProperty } from '../../context/PropertyContext';

interface SearchResult {
  type: string;
  id: string;
  propertyId: string;
  propertyName?: string;
  title: string;
  subtitle?: string;
  href: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { propertyId, isPortfolioMode } = useProperty();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['search', debounced, propertyId, isPortfolioMode],
    queryFn: async () => {
      if (!debounced) return [];
      const endpoint = isPortfolioMode ? '/v1/search/portfolio' : '/v1/search';
      const params: Record<string, string> = { q: debounced };
      if (!isPortfolioMode && propertyId) params.propertyId = propertyId;
      const res = await api.get(endpoint, { params });
      return (res.data?.data ?? res.data ?? []) as SearchResult[];
    },
    enabled: open && debounced.length >= 2 && (!!propertyId || isPortfolioMode),
  });

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) onClose();
      }
      if (e.key === 'Escape' && open) onClose();
    },
    [open, onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
        role="dialog"
        aria-label="Search"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search size={18} className="text-telivity-mid-grey flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isPortfolioMode ? 'Search all properties…' : 'Search guests, reservations, folios…'}
            className="flex-1 text-sm outline-none text-telivity-navy placeholder:text-telivity-mid-grey"
          />
          <button onClick={onClose} className="p-1 rounded hover:bg-telivity-light-grey" aria-label="Close search">
            <X size={16} className="text-telivity-mid-grey" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {debounced.length < 2 ? (
            <p className="px-4 py-6 text-sm text-telivity-mid-grey text-center">
              Type at least 2 characters to search
              <span className="block text-xs mt-1">⌘K / Ctrl+K</span>
            </p>
          ) : isFetching ? (
            <p className="px-4 py-6 text-sm text-telivity-mid-grey text-center">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-telivity-mid-grey text-center">No results</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={`${r.type}-${r.id}-${r.propertyId}`}>
                  <button
                    className="w-full text-left px-4 py-2.5 hover:bg-telivity-light-grey transition-colors border-b border-gray-50 last:border-0"
                    onClick={() => {
                      navigate(r.href);
                      onClose();
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-semibold text-telivity-teal bg-telivity-teal/10 px-1.5 py-0.5 rounded">
                        {r.type}
                      </span>
                      <span className="text-sm font-medium text-telivity-navy truncate">{r.title}</span>
                    </div>
                    {(r.subtitle || r.propertyName) && (
                      <p className="text-xs text-telivity-mid-grey mt-0.5 truncate">
                        {r.propertyName ? `${r.propertyName} · ` : ''}
                        {r.subtitle}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Global keyboard shortcut hook — opens command palette on ⌘K / Ctrl+K */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}
