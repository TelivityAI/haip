/**
 * Anti‑hallucination guard for HAIP AI explanations.
 *
 * PRIMARY guarantee is structural, not here: HAIP AI never executes anything — it
 * only annotates a decision the deterministic agent already computed, and approval
 * runs the agent's own `execute()` on the agent's own recommendation. The model
 * cannot change what happens.
 *
 * This is the SECONDARY, best‑effort guard: stop the model from *displaying* a
 * significant figure (a price, a percentage, a large count) that the agent's
 * numbers don't support. It targets gross invented figures — it is a heuristic,
 * not a proof, and deliberately ignores small action integers (min‑LOS 2, "3
 * nights") which are legitimate even when absent from the raw numbers.
 */

export interface GuardedExplanation {
  rationale: string;
  suggestions: string[];
  /** false = the rationale asserted a significant figure the agent's numbers don't support. */
  grounded: boolean;
}

/**
 * Reduce an agent's decision output to numeric leaves only — numbers and
 * numeric strings — while preserving object keys and array structure. Every
 * free‑form string (guest names, review/email bodies, subjects), boolean, and
 * null is dropped.
 *
 * This is what enforces "the model sees ONLY numbers" *structurally*: callers
 * pass the result to the model instead of the raw `recommendation`, so
 * attacker‑influenced text can never reach the prompt and steer the output
 * (prompt injection). Object KEYS are developer‑defined and kept for context.
 */
export function numericPayload(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  if (Array.isArray(value)) {
    const arr = value.map(numericPayload).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const fv = numericPayload(v);
      if (fv !== undefined) out[k] = fv;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** Collect every numeric value anywhere in the agent's decision output. */
export function decisionNumberSet(numbers: unknown, acc: Set<number> = new Set()): Set<number> {
  if (numbers == null) return acc;
  if (typeof numbers === 'number' && Number.isFinite(numbers)) {
    acc.add(numbers);
  } else if (typeof numbers === 'string') {
    const n = Number(numbers);
    if (numbers.trim() !== '' && Number.isFinite(n)) acc.add(n);
  } else if (Array.isArray(numbers)) {
    for (const v of numbers) decisionNumberSet(v, acc);
  } else if (typeof numbers === 'object') {
    for (const v of Object.values(numbers as Record<string, unknown>)) decisionNumberSet(v, acc);
  }
  return acc;
}

/**
 * "Significant" figures the model might invent: $‑amounts, percentages, and any
 * number ≥ 25. Small bare integers (< 25) are allowed — they're action params
 * (LOS, nights, counts), not hallucination‑prone financial claims.
 */
export function significantNumbers(text: string): number[] {
  const out: number[] = [];
  // One token: optional sign, optional $, digits with optional thousands
  // separators, optional decimal, optional scientific exponent, optional %.
  // Parses sign, separators (1,200), and sci notation (1e6) correctly so none
  // of them can sneak an invented figure past the guard. No nested quantifier
  // that backtracks → not ReDoS‑prone.
  const re =
    /([-+]?)(\$)?\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?)\s?(%)?/g;
  for (const m of text.matchAll(re)) {
    const sign = m[1] === '-' ? -1 : 1;
    const isMoney = !!m[2];
    const isPercent = !!m[4];
    const n = sign * Number(m[3]!.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    // $ amounts and percentages are always "significant"; bare numbers only
    // when |n| ≥ 25 (smaller bare integers are action params: LOS, nights).
    if (isMoney || isPercent || Math.abs(n) >= 25) out.push(n);
  }
  return out;
}

/**
 * A figure is supported if its magnitude matches a decision number, OR if a
 * decision number that is a genuine ratio in [0,1] equals it ÷100 (e.g. stored
 * `0.87` supports a displayed `87%`).
 *
 * Comparison is on absolute value: natural language carries sign through words
 * ("cut", "reduce") far more than a literal "-", so signed comparison would
 * false‑flag legitimate phrasing — we accept not catching a bare sign flip.
 *
 * We deliberately do NOT do the inverse ÷100 on arbitrary numbers: that is what
 * let a room count of `50` falsely "support" a hallucinated `0.5%` (0.5 ≈
 * 50/100). Only ratios in [0,1] are scaled up.
 */
export function isSupported(value: number, supported: Set<number>): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.02);
  const av = Math.abs(value);
  for (const s of supported) {
    const as = Math.abs(s);
    if (near(av, as)) return true;
    if (as <= 1 && near(av, as * 100)) return true; // ratio → percentage
  }
  return false;
}

/**
 * Filter an explanation against the agent's numbers: drop any suggestion that
 * asserts an unsupported significant figure, and flag the rationale if it does.
 */
export function groundExplanation(
  numbers: unknown,
  exp: { rationale: string; suggestions: string[] },
): GuardedExplanation {
  const supported = decisionNumberSet(numbers);
  const rationaleGrounded = significantNumbers(exp.rationale).every((n) => isSupported(n, supported));
  const suggestions = exp.suggestions.filter((s) =>
    significantNumbers(s).every((n) => isSupported(n, supported)),
  );
  return { rationale: exp.rationale, suggestions, grounded: rationaleGrounded };
}
