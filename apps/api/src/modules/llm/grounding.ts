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
  // $1,234.50 / $450
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)) {
    out.push(Number(m[1]!.replace(/,/g, '')));
  }
  // 87% / 12.5%
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) out.push(Number(m[1]));
  // bare numbers ≥ 25 (skip ones already captured as $/% by requiring no adjacent $ or %)
  for (const m of text.matchAll(/(?<![\d$.])(\d+(?:\.\d+)?)(?!\s?%)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 25) out.push(n);
  }
  return out;
}

/** A figure is supported if it (or its ×100 / ÷100 form, for percent vs ratio) matches a decision number. */
export function isSupported(value: number, supported: Set<number>): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.02);
  for (const s of supported) {
    if (near(value, s) || near(value, s * 100) || near(value, s / 100)) return true;
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
