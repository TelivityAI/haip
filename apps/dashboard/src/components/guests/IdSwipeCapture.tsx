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

/** Wedge readers emit keystrokes far faster than humans. */
const WEDGE_GAP_MS = 55;
const HUMAN_GAP_MS = 140;
const PARSE_IDLE_MS = 280;

/**
 * Silent HID keyboard-wedge capture.
 * Listens while the parent form is open; does not steal focus or block typing.
 * A desk reader still fills fields when a swipe lands; typing works as usual.
 */
export default function IdSwipeCapture({ active, onParsed }: IdSwipeCaptureProps) {
  const { t } = useTranslation();
  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const rapidCountRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onParsedRef = useRef(onParsed);
  onParsedRef.current = onParsed;
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      setSummary('');
      bufferRef.current = '';
      rapidCountRef.current = 0;
      return;
    }

    function clearIdleTimer() {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }

    function resetBuffer() {
      bufferRef.current = '';
      rapidCountRef.current = 0;
      clearIdleTimer();
    }

    function tryParse(raw: string) {
      const doc = parseIdDocumentSwipe(raw);
      resetBuffer();
      if (!doc || (!doc.firstName && !doc.lastName)) {
        if (looksLikeIdSwipe(raw) || raw.length > 40) {
          setStatus('error');
          setSummary(t('guests.idSwipeFailed'));
        }
        return;
      }
      setStatus('ok');
      setSummary(formatParsedIdSummary(doc));
      onParsedRef.current(doc);
    }

    function scheduleParse() {
      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        const raw = bufferRef.current;
        if (raw.length >= 20) tryParse(raw);
        else resetBuffer();
      }, PARSE_IDLE_MS);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      const gap = now - lastKeyAtRef.current;
      lastKeyAtRef.current = now;

      if (e.key === 'Escape') {
        resetBuffer();
        setStatus('idle');
        setSummary('');
        return;
      }

      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 20 || looksLikeIdSwipe(bufferRef.current)) {
          e.preventDefault();
          e.stopPropagation();
          clearIdleTimer();
          tryParse(bufferRef.current);
        } else {
          resetBuffer();
        }
        return;
      }

      if (e.key.length !== 1) return;

      // Slow keystroke into a short buffer = human typing in a form field — ignore.
      if (gap > HUMAN_GAP_MS && bufferRef.current.length > 0 && bufferRef.current.length < 20) {
        resetBuffer();
        return;
      }

      if (gap <= WEDGE_GAP_MS || bufferRef.current.length === 0) {
        if (gap <= WEDGE_GAP_MS) rapidCountRef.current += 1;
        bufferRef.current += e.key;
      } else if (looksLikeIdSwipe(bufferRef.current + e.key)) {
        bufferRef.current += e.key;
      } else {
        resetBuffer();
        return;
      }

      const capturing =
        rapidCountRef.current >= 4 ||
        bufferRef.current.length >= 20 ||
        looksLikeIdSwipe(bufferRef.current);

      if (capturing) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (bufferRef.current.length >= 20) scheduleParse();
    }

    function onPaste(e: ClipboardEvent) {
      const text = e.clipboardData?.getData('text') ?? '';
      if (text && looksLikeIdSwipe(text)) {
        e.preventDefault();
        tryParse(text);
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('paste', onPaste, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('paste', onPaste, true);
      clearIdleTimer();
      bufferRef.current = '';
      rapidCountRef.current = 0;
    };
  }, [active, t]);

  if (!active) return null;

  if (status === 'idle') {
    return (
      <p className="text-[11px] text-telivity-mid-grey flex items-center gap-1.5">
        <CreditCard size={12} className="text-telivity-teal shrink-0" />
        {t('guests.idSwipeHint')}
      </p>
    );
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2 flex items-start gap-2 ${
        status === 'ok'
          ? 'border-telivity-teal/40 bg-telivity-teal/5'
          : 'border-telivity-orange/40 bg-telivity-orange/5'
      }`}
      role="status"
    >
      {status === 'ok' ? (
        <CheckCircle2 size={16} className="text-telivity-teal mt-0.5 shrink-0" />
      ) : (
        <CreditCard size={16} className="text-telivity-orange mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-telivity-navy">
          {status === 'ok' ? t('guests.idSwipeSuccess') : t('guests.idSwipeFailedShort', {
            defaultValue: 'Swipe not read',
          })}
        </p>
        <p className="text-[11px] text-telivity-mid-grey mt-0.5">{summary}</p>
      </div>
    </div>
  );
}
