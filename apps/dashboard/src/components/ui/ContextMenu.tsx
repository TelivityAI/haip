import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';

export interface ActionMenuItem {
  id?: string;
  label: string;
  icon?: React.ReactNode;
  variant?: 'normal' | 'emphasized' | 'danger';
  disabled?: boolean;
  hidden?: boolean;
  divider?: boolean;
  header?: boolean;
  onClick?: () => void | Promise<void>;
  children?: ActionMenuItem[];
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuProps {
  items: ActionMenuItem[];
  position: ContextMenuPosition | null;
  onClose: () => void;
  className?: string;
}

export function ActionMenuList({
  items,
  onItemClick,
  onSubmenuHover,
  activeSubmenuId,
}: {
  items: ActionMenuItem[];
  onItemClick: (item: ActionMenuItem) => void;
  onSubmenuHover: (id: string | null, parentRect?: DOMRect) => void;
  activeSubmenuId: string | null;
}) {
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  return (
    <div className="py-1 text-xs text-telivity-navy">
      {items
        .filter((item) => !item.hidden)
        .map((item, idx) => {
          const itemId = item.id || `item-${idx}-${item.label}`;

          if (item.divider) {
            return <div key={itemId} className="my-1 border-t border-gray-100" role="separator" />;
          }

          if (item.header) {
            return (
              <div
                key={itemId}
                className="px-3 py-1 font-semibold text-[10px] text-telivity-mid-grey uppercase tracking-wider select-none"
              >
                {item.label}
              </div>
            );
          }

          const hasChildren = Boolean(item.children && item.children.length > 0);
          const isSubmenuOpen = activeSubmenuId === itemId;

          let variantClasses = 'text-telivity-navy hover:bg-gray-100';
          if (item.variant === 'danger') {
            variantClasses = 'text-red-600 hover:bg-red-50';
          } else if (item.variant === 'emphasized') {
            variantClasses = 'text-telivity-teal font-medium hover:bg-telivity-teal/10';
          }

          return (
            <div
              key={itemId}
              ref={(el) => {
                if (el) itemRefs.current.set(itemId, el);
                else itemRefs.current.delete(itemId);
              }}
              className="relative"
              onMouseEnter={() => {
                if (hasChildren) {
                  const rect = itemRefs.current.get(itemId)?.getBoundingClientRect();
                  onSubmenuHover(itemId, rect);
                } else {
                  onSubmenuHover(null);
                }
              }}
            >
              <button
                type="button"
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled) return;
                  if (!hasChildren) {
                    onItemClick(item);
                  }
                }}
                className={`w-full flex items-center justify-between px-3 py-1.5 transition-colors text-left ${variantClasses} ${
                  item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                } ${isSubmenuOpen ? 'bg-gray-100' : ''}`}
              >
                <div className="flex items-center gap-2 truncate">
                  {item.icon && <span className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">{item.icon}</span>}
                  <span className="truncate">{item.label}</span>
                </div>
                {hasChildren && <ChevronRight size={12} className="text-telivity-mid-grey ml-2 flex-shrink-0" />}
              </button>
            </div>
          );
        })}
    </div>
  );
}

export function ContextMenu({ items, position, onClose, className = '' }: ContextMenuProps) {
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [submenuRect, setSubmenuRect] = useState<DOMRect | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or ESC key
  useEffect(() => {
    if (!position) return;

    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [position, onClose]);

  const handleSubmenuHover = useCallback((id: string | null, parentRect?: DOMRect) => {
    setActiveSubmenuId(id);
    setSubmenuRect(parentRect ?? null);
  }, []);

  const handleItemClick = useCallback(
    (item: ActionMenuItem) => {
      onClose();
      if (item.onClick) {
        item.onClick();
      }
    },
    [onClose],
  );

  if (!position) return null;

  // Viewport clamping
  const menuWidth = 190;
  const menuMaxHeight = 320;
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 768;

  let left = position.x;
  let top = position.y;

  if (left + menuWidth > windowWidth - 10) {
    left = Math.max(10, windowWidth - menuWidth - 10);
  }
  if (top + menuMaxHeight > windowHeight - 10) {
    top = Math.max(10, windowHeight - menuMaxHeight - 10);
  }

  const activeParentItem = items.find((it, idx) => (it.id || `item-${idx}-${it.label}`) === activeSubmenuId);

  // Submenu positioning
  let subLeft = left + menuWidth - 4;
  let subTop = top;
  if (submenuRect) {
    subTop = submenuRect.top;
    if (submenuRect.right + menuWidth > windowWidth - 10) {
      subLeft = Math.max(10, submenuRect.left - menuWidth + 4);
    } else {
      subLeft = submenuRect.right - 4;
    }
  }

  const content = (
    <div
      ref={menuRef}
      className={`fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 min-w-[180px] max-w-[240px] animate-in fade-in zoom-in-95 duration-100 ${className}`}
      style={{ left: `${left}px`, top: `${top}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <ActionMenuList
        items={items}
        onItemClick={handleItemClick}
        onSubmenuHover={handleSubmenuHover}
        activeSubmenuId={activeSubmenuId}
      />

      {/* Nested Submenu */}
      {activeParentItem && activeParentItem.children && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 min-w-[170px] max-w-[220px] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: `${subLeft}px`, top: `${subTop}px` }}
          onMouseEnter={() => {
            // Keep submenu open
          }}
          onMouseLeave={() => {
            setActiveSubmenuId(null);
          }}
        >
          <ActionMenuList
            items={activeParentItem.children}
            onItemClick={handleItemClick}
            onSubmenuHover={() => {}}
            activeSubmenuId={null}
          />
        </div>
      )}
    </div>
  );

  return createPortal(content, document.body);
}

export interface QuickActionButtonProps {
  items: ActionMenuItem[];
  triggerIcon?: React.ReactNode;
  label?: string;
  className?: string;
  variant?: 'outline' | 'ghost';
  disabled?: boolean;
}

export function QuickActionButton({
  items,
  triggerIcon,
  label,
  className = '',
  variant = 'ghost',
  disabled = false,
}: QuickActionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<ContextMenuPosition | null>(null);

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (isOpen) {
      setIsOpen(false);
      setMenuPosition(null);
    } else if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({ x: rect.left, y: rect.bottom + 4 });
      setIsOpen(true);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={toggleMenu}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
          variant === 'outline'
            ? 'border border-gray-200 bg-white hover:bg-gray-50 text-telivity-slate'
            : 'hover:bg-gray-100 text-telivity-slate'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
      >
        {triggerIcon}
        {label && <span>{label}</span>}
      </button>

      {isOpen && (
        <ContextMenu
          items={items}
          position={menuPosition}
          onClose={() => {
            setIsOpen(false);
            setMenuPosition(null);
          }}
        />
      )}
    </>
  );
}
