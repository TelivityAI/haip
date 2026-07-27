import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: ToastType, message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm" role="log" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const ICONS = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'border-telivity-dark-teal bg-telivity-dark-teal/5',
  error: 'border-telivity-orange bg-telivity-orange/5',
  info: 'border-telivity-deep-blue bg-telivity-deep-blue/5',
};

const ICON_COLORS = {
  success: 'text-telivity-dark-teal',
  error: 'text-telivity-orange',
  info: 'text-telivity-deep-blue',
};

const BAR_COLORS = {
  success: 'bg-telivity-dark-teal',
  error: 'bg-telivity-orange',
  info: 'bg-telivity-deep-blue',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICONS[toast.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef(4000);
  const startRef = useRef(Date.now());
  const onDismissRef = useRef(onDismiss);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismissRef.current();
    }, remainingRef.current);
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const rem = Math.max(0, remainingRef.current - elapsed);
      setProgress((rem / 4000) * 100);
    }, 50);
  }, []);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      const elapsed = Date.now() - startRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
      setProgress((remainingRef.current / 4000) * 100);
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [startTimer]);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 bg-white rounded-xl shadow-lg border-l-4 relative overflow-hidden ${STYLES[toast.type]} animate-slide-in`}
      role="alert"
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <Icon size={18} className={`mt-0.5 flex-shrink-0 ${ICON_COLORS[toast.type]}`} aria-hidden="true" />
      <p className="text-sm text-telivity-navy flex-1">{toast.message}</p>
      <button onClick={onDismiss} className="p-0.5 hover:bg-black/5 rounded" aria-label="Dismiss">
        <X size={14} className="text-telivity-mid-grey" />
      </button>
      <div
        className={`absolute bottom-0 left-0 h-1 transition-all duration-75 ease-linear ${BAR_COLORS[toast.type]}`}
        style={{ width: `${progress}%` }}
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Toast timeout"
      />
    </div>
  );
}


