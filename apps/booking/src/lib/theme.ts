/**
 * Embed-time theming. A host site (a Remy/v0-generated page, a Webflow site, or any
 * hand-built site) can pass brand tokens on the mount element so the widget blends in —
 * independent of, and taking precedence over, the per-property branding from `/config`.
 *
 * Two ways to pass a theme on the mount element (or the embed <script>):
 *
 *   1. A JSON blob (what Remy injects):
 *      <div id="haip-booking" data-booking-key="pk_live_…"
 *           data-theme='{"primary":"#0a7","font":"Inter, sans-serif","radius":"14px"}'></div>
 *
 *   2. Individual attributes (hand-authoring convenience):
 *      <div … data-theme-primary="#0a7" data-theme-font="Inter, sans-serif" data-theme-radius="14px"></div>
 *
 * Only known tokens are honored; values are sanitized before they reach CSS variables.
 */

/** Public theme token → the CSS variable the widget reads. Whitelist (nothing else is applied). */
export const THEME_TOKENS: Record<string, string> = {
  primary: '--haip-primary', // brand / primary button background
  accent: '--haip-accent', // secondary accents
  onPrimary: '--haip-on-primary', // text/icon color on the primary button
  font: '--haip-font', // font-family stack
  radius: '--haip-radius', // corner radius (e.g. 14px, 0.5rem)
  text: '--haip-text', // body text color
  surface: '--haip-surface', // card/panel background
};

/** Strip characters that could break out of a CSS value. setProperty already rejects invalid
 *  values, but we defensively drop `;`, braces, and control chars and cap length. */
function sanitize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[;{}<>]/g, '').trim();
  if (!cleaned || cleaned.length > 200) return null;
  return cleaned;
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/**
 * Resolve a theme from the mount element + the current embed <script>, returning a map of
 * CSS-variable → value for the known, sanitized tokens. Element attributes win over the script's.
 */
export function resolveTheme(mountEl?: Element | null): Record<string, string> {
  const out: Record<string, string> = {};

  const sources: Array<Element | null> = [];
  // Lower priority first; later sources override earlier.
  if (typeof document !== 'undefined') {
    sources.push((document.currentScript as HTMLScriptElement | null) ?? null);
  }
  sources.push(mountEl ?? null);

  for (const el of sources) {
    if (!el) continue;

    // 1. JSON blob
    const json = el.getAttribute?.('data-theme');
    if (json) {
      try {
        const obj = JSON.parse(json) as Record<string, unknown>;
        for (const [token, cssVar] of Object.entries(THEME_TOKENS)) {
          const v = sanitize(obj[token]);
          if (v) out[cssVar] = v;
        }
      } catch {
        /* malformed JSON → ignore, fall through to individual attrs */
      }
    }

    // 2. Individual data-theme-<token> attributes (override the JSON for the same source)
    for (const [token, cssVar] of Object.entries(THEME_TOKENS)) {
      const v = sanitize(el.getAttribute?.(`data-theme-${kebab(token)}`));
      if (v) out[cssVar] = v;
    }
  }

  return out;
}

/** Apply resolved CSS variables onto the widget's container (scoped — never the host page). */
export function applyTheme(el: Element, vars: Record<string, string>): void {
  const style = (el as HTMLElement).style;
  if (!style) return;
  for (const [cssVar, value] of Object.entries(vars)) {
    style.setProperty(cssVar, value);
  }
}
