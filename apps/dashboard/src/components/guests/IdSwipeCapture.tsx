import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, CheckCircle2 } from 'lucide-react';
import {
  formatParsedIdSummary,
  looksLikeIdSwipe,
  parseIdDocumentSwipe,
  type ParsedIdDocument,
} from '../../lib/id-document-swipe';

export interface IdSwipeCaptureProps {
  active: boolean;
  onParsed: (doc: ParsedIdDocument) => void;
}

/**
 * Capture zone for HID keyboard-wedge ID / passport readers.
 * Auto-focuses when active so a swipe lands here without clicking a field.
 */
export default function IdSwipeCapture({ active, onParsed }: IdSwipeCaptureProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      setSummary('');
      bufferRef.current = '';
      return;
    }
    const focus = () => inputRef.current?.focus();
    focus();
    const tFocus = window.setTimeout(focus, 80);
    return () => window.clearTimeout(tFocus);
  }, [active]);

  function clearIdleTimer() {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  function tryParse(raw: string) {
    const doc = parseIdDocumentSwipe(raw);
    bufferRef.current = '';
    if (inputRef.current) inputRef.current.value = '';
    if (!doc || (!doc.firstName && !doc.lastName)) {
      if (looksLikeIdSwipe(raw) || raw.length > 40) {
        setStatus('error');
        setSummary(t('guests.idSwipeFailed'));
      }
      return;
    }
    setStatus('ok');
    setSummary(formatParsedIdSummary(doc));
    onParsed(doc);
  }

  function scheduleParse() {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      const raw = bufferRef.current;
      if (raw.length >= 20) tryParse(raw);
    }, 280);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const now = Date.now();
    const gap = now - lastKeyAtRef.current;
    lastKeyAtRef.current = now;

    // Slow typing into this field — reset buffer so names don't false-trigger
    if (gap > 120 && bufferRef.current.length > 0 && bufferRef.current.length < 15) {
      bufferRef.current = '';
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      clearIdleTimer();
      tryParse(bufferRef.current || e.currentTarget.value);
      return;
    }
    if (e.key === 'Escape') {
      bufferRef.current = '';
      setStatus('idle');
      setSummary('');
      return;
    }
    if (e.key.length === 1) {
      bufferRef.current += e.key;
      if (bufferRef.current.length >= 20) scheduleParse();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (text && looksLikeIdSwipe(text)) {
      e.preventDefault();
      tryParse(text);
    }
  }

  if (!active) return null;

  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        status === 'ok'
          ? 'border-telivity-teal/40 bg-telivity-teal/5'
          : status === 'error'
            ? 'border-telivity-orange/40 bg-telivity-orange/5'
            : 'border-dashed border-telivity-teal/40 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-telivity-teal">
          {status === 'ok' ? <CheckCircle2 size={20} /> : <CreditCard size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-telivity-navy">
            {status === 'ok' ? t('guests.idSwipeSuccess') : t('guests.idSwipeTitle')}
          </p>
          <p className="text-xs text-telivity-mid-grey mt-0.5">
            {status === 'idle' ? t('guests.idSwipeHint') : summary}
          </p>
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t('guests.idSwipeTitle')}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              if (active) window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-telivity-teal"
            placeholder={t('guests.idSwipePlaceholder')}
          />
        </div>
      </div>
    </div>
  );
}
