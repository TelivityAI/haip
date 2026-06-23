import { describe, it, expect } from 'vitest';
import { resolveTheme, applyTheme, THEME_TOKENS } from './theme';

function el(attrs: Record<string, string>): HTMLElement {
  const d = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) d.setAttribute(k, v);
  return d;
}

describe('resolveTheme', () => {
  it('maps a data-theme JSON blob to the right CSS variables', () => {
    const t = resolveTheme(
      el({ 'data-theme': '{"primary":"#0a7","font":"Inter, sans-serif","radius":"14px"}' }),
    );
    expect(t['--haip-primary']).toBe('#0a7');
    expect(t['--haip-font']).toBe('Inter, sans-serif');
    expect(t['--haip-radius']).toBe('14px');
  });

  it('reads individual data-theme-* attributes', () => {
    const t = resolveTheme(el({ 'data-theme-primary': '#123456', 'data-theme-on-primary': '#000' }));
    expect(t['--haip-primary']).toBe('#123456');
    expect(t['--haip-on-primary']).toBe('#000');
  });

  it('individual attributes override the JSON blob on the same element', () => {
    const t = resolveTheme(el({ 'data-theme': '{"primary":"#aaa"}', 'data-theme-primary': '#bbb' }));
    expect(t['--haip-primary']).toBe('#bbb');
  });

  it('ignores unknown tokens', () => {
    const t = resolveTheme(el({ 'data-theme': '{"evil":"x","primary":"#0a7"}' }));
    expect(t['--haip-primary']).toBe('#0a7');
    expect(Object.keys(t)).toEqual(['--haip-primary']);
  });

  it('sanitizes values that try to break out of the CSS value', () => {
    const t = resolveTheme(el({ 'data-theme-primary': 'red; } body { display:none' }));
    // `;` and `}` stripped → a harmless (if odd) value, never a CSS escape
    expect(t['--haip-primary']).toBeDefined();
    expect(t['--haip-primary']).not.toContain(';');
    expect(t['--haip-primary']).not.toContain('}');
  });

  it('falls back to individual attrs when JSON is malformed', () => {
    const t = resolveTheme(el({ 'data-theme': '{not json', 'data-theme-accent': '#f00' }));
    expect(t['--haip-accent']).toBe('#f00');
  });

  it('returns empty for an element with no theme attrs', () => {
    expect(resolveTheme(el({}))).toEqual({});
    expect(resolveTheme(null)).toEqual({});
  });
});

describe('applyTheme', () => {
  it('sets each variable as a scoped inline CSS property on the element', () => {
    const d = document.createElement('div');
    applyTheme(d, { '--haip-primary': '#0a7', '--haip-radius': '14px' });
    expect(d.style.getPropertyValue('--haip-primary')).toBe('#0a7');
    expect(d.style.getPropertyValue('--haip-radius')).toBe('14px');
  });
});

describe('THEME_TOKENS', () => {
  it('every token maps to a --haip- CSS variable', () => {
    for (const cssVar of Object.values(THEME_TOKENS)) expect(cssVar).toMatch(/^--haip-/);
  });
});
