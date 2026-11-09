import React, { useState, useEffect, useRef, useId } from 'react';
import { Check, ChevronDown, Loader2, Plus, X } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
  secondary?: string;
  data?: unknown;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string, option?: ComboboxOption) => void;
  options?: ComboboxOption[];
  onSearch?: (query: string) => Promise<ComboboxOption[]> | ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  allowCustom?: boolean;
  customLabelPrefix?: string;
  className?: string;
  autoUppercase?: boolean;
}

export default function Combobox({
  value,
  onChange,
  options: staticOptions,
  onSearch,
  placeholder = '',
  disabled = false,
  allowCustom = true,
  customLabelPrefix = '+ ',
  className = '',
  autoUppercase = false,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>(staticOptions ?? []);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Selected item display
  const selectedOption = options.find((opt) => opt.value === value) ??
    (staticOptions ? staticOptions.find((opt) => opt.value === value) : undefined);

  // Sync display text when value changes
  useEffect(() => {
    if (!isOpen) {
      if (selectedOption) {
        setQuery(selectedOption.label);
      } else {
        setQuery(value ?? '');
      }
    }
  }, [value, selectedOption, isOpen]);

  // Synchronize static options when they change
  useEffect(() => {
    if (staticOptions) {
      setOptions(staticOptions);
    }
  }, [staticOptions]);

  // Debounced search when onSearch is provided
  useEffect(() => {
    if (!onSearch) {
      if (staticOptions) {
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) {
          setOptions(staticOptions);
        } else {
          setOptions(
            staticOptions.filter(
              (opt) =>
                opt.label.toLowerCase().includes(trimmed) ||
                opt.value.toLowerCase().includes(trimmed) ||
                opt.secondary?.toLowerCase().includes(trimmed),
            ),
          );
        }
      }
      return;
    }

    if (!isOpen) return;

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await onSearch(query);
        setOptions(results);
      } catch (err) {
        console.error('Error fetching combobox options:', err);
      } finally {
        setLoading(false);
        setHighlightedIndex(0);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, onSearch, isOpen, staticOptions]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (selectedOption) {
          setQuery(selectedOption.label);
        } else {
          setQuery(value ?? '');
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedOption, value]);

  const handleSelect = (option: ComboboxOption) => {
    onChange(option.value, option);
    setQuery(option.label);
    setIsOpen(false);
  };

  const handleCreateCustom = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const finalVal = autoUppercase ? trimmed.toUpperCase() : trimmed;
    const customOpt: ComboboxOption = { value: finalVal, label: finalVal };
    onChange(finalVal, customOpt);
    setQuery(finalVal);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      e.preventDefault();
      setIsOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % Math.max(1, options.length + (showCustomOption ? 1 : 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const total = options.length + (showCustomOption ? 1 : 0);
      setHighlightedIndex((prev) => (prev - 1 + total) % Math.max(1, total));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showCustomOption && highlightedIndex === options.length) {
        handleCreateCustom();
      } else if (options[highlightedIndex]) {
        handleSelect(options[highlightedIndex]!);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setQuery(selectedOption?.label ?? value ?? '');
    }
  };

  const showCustomOption =
    allowCustom &&
    query.trim().length > 0 &&
    !options.some((opt) => opt.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          onFocus={() => {
            setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onChange={(e) => {
            const val = autoUppercase ? e.target.value.toUpperCase() : e.target.value;
            setQuery(val);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`w-full border border-gray-200 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:border-telivity-teal bg-white transition-colors disabled:bg-gray-50 disabled:text-gray-400 ${
            autoUppercase ? 'uppercase' : ''
          }`}
        />

        <div className="absolute right-2 flex items-center gap-1 text-gray-400">
          {loading && <Loader2 size={14} className="animate-spin text-telivity-teal" />}
          {value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                onChange('');
                setQuery('');
                inputRef.current?.focus();
              }}
              className="p-0.5 hover:text-gray-600 rounded"
            >
              <X size={13} />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setIsOpen(!isOpen);
                inputRef.current?.focus();
              }
            }}
            className="p-0.5 hover:text-gray-600 rounded"
          >
            <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm focus:outline-none animate-in fade-in-50"
        >
          {options.length === 0 && !showCustomOption && !loading && (
            <li className="px-3 py-2 text-xs text-gray-400 text-center">
              Nenhuma opção encontrada
            </li>
          )}

          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightedIndex;
            return (
              <li
                key={`${option.value}-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => handleSelect(option)}
                className={`px-3 py-2 cursor-pointer flex items-center justify-between text-xs transition-colors ${
                  isHighlighted ? 'bg-telivity-teal/10 text-telivity-teal font-medium' : 'text-gray-700'
                } ${isSelected ? 'font-semibold text-telivity-navy' : ''}`}
              >
                <div className="flex flex-col truncate">
                  <span className="truncate">{option.label}</span>
                  {option.secondary && (
                    <span className="text-[10px] text-gray-400 truncate">{option.secondary}</span>
                  )}
                </div>
                {isSelected && <Check size={14} className="text-telivity-teal shrink-0 ml-2" />}
              </li>
            );
          })}

          {showCustomOption && (
            <li
              role="option"
              onMouseEnter={() => setHighlightedIndex(options.length)}
              onClick={handleCreateCustom}
              className={`px-3 py-2 cursor-pointer flex items-center gap-1.5 text-xs border-t border-gray-100 ${
                highlightedIndex === options.length
                  ? 'bg-telivity-teal/15 text-telivity-teal font-medium'
                  : 'text-telivity-teal'
              }`}
            >
              <Plus size={13} className="shrink-0" />
              <span className="truncate font-semibold">
                {customLabelPrefix}"{autoUppercase ? query.trim().toUpperCase() : query.trim()}"
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
