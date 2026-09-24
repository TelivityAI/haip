/**
 * Autopilot risk tiers — one confidence number is not equal across agents.
 * Money-moving writes need a harder floor; guest-facing drafts never auto-run.
 */

export type AutopilotRiskTier = 'money' | 'ops' | 'guest';

const MONEY_AGENTS = new Set([
  'pricing',
  'overbooking',
  'channel_mix',
  'revenue_manager',
  'group_pickup',
]);

const GUEST_AGENTS = new Set(['guest_comms', 'review_response']);

/** Floor applied on top of the property's configured autopilot threshold for money agents. */
export const MONEY_AUTOPILOT_FLOOR = 0.92;

export function autopilotRiskTier(agentType: string): AutopilotRiskTier {
  if (MONEY_AGENTS.has(agentType)) return 'money';
  if (GUEST_AGENTS.has(agentType)) return 'guest';
  return 'ops';
}

/**
 * Whether autopilot may auto-execute this recommendation.
 * Guest-facing agents always return false (human approve).
 * Money agents require confidence >= max(configThreshold, MONEY_AUTOPILOT_FLOOR).
 * Ops agents use the config threshold as today.
 */
export function shouldAutoExecuteDecision(input: {
  mode: string;
  agentType: string;
  confidence: number;
  configThreshold: number;
}): boolean {
  if (input.mode !== 'autopilot') return false;

  const tier = autopilotRiskTier(input.agentType);
  if (tier === 'guest') return false;

  const threshold =
    tier === 'money'
      ? Math.max(input.configThreshold, MONEY_AUTOPILOT_FLOOR)
      : input.configThreshold;

  return input.confidence >= threshold;
}
