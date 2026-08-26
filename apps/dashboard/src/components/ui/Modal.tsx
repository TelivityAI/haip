import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}

export default function Modal({ open, onClose, title, children, wide, closeDisabled = false }: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDialogElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (!open) return;
    const dialog = panelRef.current;
    const overlay = overlayRef.current;
    if (!dialog || !overlay) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const siblings = Array.from(document.body.children)
      .filter((element) => element !== overlay);
    const previousSiblingState = siblings.map((element) => ({
      element,
      inert: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    for (const sibling of siblings) {
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }

    const supportsNativeModal = typeof dialog.showModal === 'function';
    if (supportsNativeModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.focus();

    const guardFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) dialog.focus();
    };
    const guardClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !overlay.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const fallbackEscape = (event: KeyboardEvent) => {
      if (!supportsNativeModal && event.key === 'Escape' && !closeDisabledRef.current) {
        onCloseRef.current();
      }
    };
    const closeFromNativeBackdrop = (event: MouseEvent) => {
      if (event.target === dialog && !closeDisabledRef.current) onCloseRef.current();
    };
    document.addEventListener('focusin', guardFocus, true);
    document.addEventListener('click', guardClick, true);
    document.addEventListener('keydown', fallbackEscape);
    dialog.addEventListener('click', closeFromNativeBackdrop);

    return () => {
      document.removeEventListener('focusin', guardFocus, true);
      document.removeEventListener('click', guardClick, true);
      document.removeEventListener('keydown', fallbackEscape);
      dialog.removeEventListener('click', closeFromNativeBackdrop);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      for (const state of previousSiblingState) {
        if (!state.inert) state.element.removeAttribute('inert');
        if (state.ariaHidden == null) state.element.removeAttribute('aria-hidden');
        else state.element.setAttribute('aria-hidden', state.ariaHidden);
      }
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        data-modal-backdrop
        tabIndex={-1}
        aria-label={`${t('common.close')} ${title}`}
        className="absolute inset-0 border-0 bg-black/40 p-0"
        disabled={closeDisabled}
        onClick={onClose}
      />
      <dialog
        ref={panelRef}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onCancel={(event) => {
          event.preventDefault();
          if (!closeDisabled) onClose();
        }}
        className={`fixed inset-0 m-auto max-h-[85vh] border-0 bg-white p-0 rounded-xl shadow-xl outline-none backdrop:bg-black/40 ${wide ? 'w-[calc(100%-2rem)] max-w-2xl' : 'w-[calc(100%-2rem)] max-w-md'} overflow-y-auto`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id={titleId} className="text-lg font-semibold text-telivity-navy">{title}</h2>
          <button type="button" aria-label={t('common.close')} disabled={closeDisabled} onClick={onClose} className="p-1 rounded-lg hover:bg-telivity-light-grey transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue disabled:cursor-not-allowed disabled:opacity-50">
            <X size={18} className="text-telivity-mid-grey" aria-hidden="true" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </dialog>
    </div>,
    document.body,
  );
}
