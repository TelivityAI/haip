import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom has no canvas implementation; SignaturePad and similar need a stub.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,');
}
