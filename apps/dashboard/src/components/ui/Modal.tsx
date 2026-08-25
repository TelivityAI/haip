import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}

export default function Modal({ open, onClose, title, children, wide }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const previousFocus = document.activeElement as HTMLElement | null;
      panelRef.current?.focus();
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onCloseRef.current();
      };
      document.addEventListener('keydown', onKeyDown);
      return () => {
        document.body.style.overflow = previousOverflow;
        document.removeEventListener('keydown', onKeyDown);
        previousFocus?.focus();
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <dialog
        open
        ref={panelRef}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative m-4 max-h-[85vh] border-0 bg-white p-0 rounded-xl shadow-xl outline-none ${wide ? 'w-full max-w-2xl' : 'w-full max-w-md'} overflow-y-auto`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id={titleId} className="text-lg font-semibold text-telivity-navy">{title}</h2>
          <button aria-label={`Close ${title}`} onClick={onClose} className="p-1 rounded-lg hover:bg-telivity-light-grey transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-telivity-deep-blue">
            <X size={18} className="text-telivity-mid-grey" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </dialog>
    </div>
  );
}
