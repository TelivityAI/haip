import { useCallback, useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };

export interface SignaturePadProps {
  label: string;
  clearLabel: string;
  hint: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  /** Border / stroke colors to match check-in theme. */
  borderColor?: string;
  strokeColor?: string;
  backgroundColor?: string;
}

/**
 * Touch + mouse signature capture. Emits a PNG data-URL when the guest lifts
 * the pointer after drawing; Clear resets to empty.
 */
export function SignaturePad({
  label,
  clearLabel,
  hint,
  value,
  onChange,
  disabled = false,
  borderColor = '#e4e4ec',
  strokeColor = '#444863',
  backgroundColor = '#ffffff',
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<Point | null>(null);
  const [hasInk, setHasInk] = useState(Boolean(value));

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cssWidth = parent?.clientWidth || 320;
    const cssHeight = 160;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    // jsdom (unit tests) has no 2d context — skip draw setup there.
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.25;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Restore prior capture after resize (e.g. orientation change).
    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
      };
      img.src = value;
    }
  }, [backgroundColor, strokeColor, value]);

  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resizeCanvas]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointFromEvent(e);
    setHasInk(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !last.current) return;
    const next = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    // Defer so hasInk state flush is visible before export.
    requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      onChange(canvas.toDataURL('image/png'));
    });
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const rect = canvas.getBoundingClientRect();
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium" style={{ color: strokeColor }}>
          {label}
        </p>
        <button
          type="button"
          className="text-xs font-medium underline disabled:opacity-40"
          style={{ color: strokeColor }}
          disabled={disabled || !hasInk}
          onClick={clear}
        >
          {clearLabel}
        </button>
      </div>
      <div
        className="overflow-hidden rounded-2xl border"
        style={{ borderColor, background: backgroundColor, touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="block w-full cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={(e) => {
            if (drawing.current) endStroke(e);
          }}
        />
      </div>
      <p className="text-xs" style={{ color: '#8a8ca0' }}>
        {hint}
      </p>
    </div>
  );
}
