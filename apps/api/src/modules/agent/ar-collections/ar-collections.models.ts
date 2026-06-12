/**
 * A/R collections prioritization models.
 *
 * Scores open A/R ledgers (KB 11) by collection priority so staff focus first on
 * the ledgers most worth chasing: large balances, transfers that have aged well
 * past their payment terms, and ledgers with many open transfers.
 *
 * All formulas are simple, documented, and deterministic (no history required).
 */

export interface ArAgingInput {
  arLedgerId: string;
  ledgerName: string;
  balance: number;
  oldestTransferAgeDays: number;
  openTransferCount: number;
  paymentTermsDays: number | null;
}

export interface ArCollectionScore {
  arLedgerId: string;
  ledgerName: string;
  priorityScore: number; // 0..1
  riskLevel: 'low' | 'medium' | 'high';
  recommendedAction: string;
  balance: number;
  daysOverdue: number;
}

// Default payment terms when a ledger has none configured (NET30 convention).
const DEFAULT_PAYMENT_TERMS_DAYS = 30;

// Saturation constants — the balance/age/count beyond which the sub-score is ~maxed.
// These keep each component in [0,1) via x/(x+k) saturation curves.
const BALANCE_SATURATION = 10000; // currency units
const OVERDUE_SATURATION = 60; // days past terms
const COUNT_SATURATION = 5; // open transfers

// Component weights (sum to 1).
const W_BALANCE = 0.4;
const W_OVERDUE = 0.4;
const W_COUNT = 0.2;

/**
 * Saturating ratio x/(x+k), clamped to [0,1). Monotonically increasing in x>=0.
 */
function saturate(value: number, k: number): number {
  const x = Math.max(0, value);
  return x / (x + k);
}

/**
 * Score a single A/R ledger for collection priority.
 *
 * priorityScore (0..1) increases with balance, overdue age (beyond payment terms),
 * and the number of open transfers. daysOverdue is clamped at 0.
 */
export function scoreArLedger(input: ArAgingInput): ArCollectionScore {
  const terms = input.paymentTermsDays ?? DEFAULT_PAYMENT_TERMS_DAYS;
  const daysOverdue = Math.max(0, input.oldestTransferAgeDays - terms);

  const balanceScore = saturate(input.balance, BALANCE_SATURATION);
  const overdueScore = saturate(daysOverdue, OVERDUE_SATURATION);
  const countScore = saturate(input.openTransferCount, COUNT_SATURATION);

  const priorityScore =
    Math.round(
      (W_BALANCE * balanceScore + W_OVERDUE * overdueScore + W_COUNT * countScore) * 1000,
    ) / 1000;

  let riskLevel: ArCollectionScore['riskLevel'];
  let recommendedAction: string;
  if (priorityScore >= 0.66) {
    riskLevel = 'high';
    recommendedAction = 'send_final_notice';
  } else if (priorityScore >= 0.33) {
    riskLevel = 'medium';
    recommendedAction = 'send_reminder';
  } else {
    riskLevel = 'low';
    recommendedAction = 'monitor';
  }

  return {
    arLedgerId: input.arLedgerId,
    ledgerName: input.ledgerName,
    priorityScore,
    riskLevel,
    recommendedAction,
    balance: input.balance,
    daysOverdue,
  };
}

/**
 * Rank collection scores by priorityScore descending (highest priority first).
 */
export function rankCollections(scores: ArCollectionScore[]): ArCollectionScore[] {
  return [...scores].sort((a, b) => b.priorityScore - a.priorityScore);
}
