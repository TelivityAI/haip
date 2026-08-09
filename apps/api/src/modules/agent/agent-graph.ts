/**
 * Single source of truth for the HAIP agent dependency graph.
 *
 * HAIP orchestrates HAIP agents (RManager + schedules/events).
 * OTAIP orchestrates OTAIP agents over the Connect API — do not embed
 * a second generic pipeline runtime here.
 */

/** All known agent type keys (incl. types without an implementation yet). */
export const VALID_AGENT_TYPES = [
  'pricing',
  'demand_forecast',
  'channel_mix',
  'overbooking',
  'night_audit',
  'housekeeping',
  'cancellation',
  'guest_comms',
  'review_response',
  'ar_collections',
  'deposit_risk',
  'group_pickup',
  'revenue_manager',
] as const;

export type AgentType = (typeof VALID_AGENT_TYPES)[number];

export type AgentSubgraph = 'revenue' | 'ops' | 'guest_commercial';

export interface AgentGraphEdge {
  from: AgentType;
  to: AgentType;
}

/**
 * Order RManager gathers revenue levers: demand first, then consumers.
 * `revenue_manager` itself is the synthesizer (not a lever).
 */
export const REVENUE_LEVER_ORDER = [
  'demand_forecast',
  'pricing',
  'overbooking',
  'channel_mix',
  'group_pickup',
] as const satisfies readonly AgentType[];

export type RevenueLeverType = (typeof REVENUE_LEVER_ORDER)[number];

/** Revenue subgraph edges: demand → levers → RManager. */
export const REVENUE_EDGES: readonly AgentGraphEdge[] = [
  { from: 'demand_forecast', to: 'pricing' },
  { from: 'demand_forecast', to: 'overbooking' },
  { from: 'demand_forecast', to: 'channel_mix' },
  { from: 'demand_forecast', to: 'group_pickup' },
  { from: 'pricing', to: 'revenue_manager' },
  { from: 'overbooking', to: 'revenue_manager' },
  { from: 'channel_mix', to: 'revenue_manager' },
  { from: 'group_pickup', to: 'revenue_manager' },
];

/** Ops specialists (event/cron; not inside RManager). */
export const OPS_AGENT_TYPES = [
  'night_audit',
  'housekeeping',
  'cancellation',
] as const satisfies readonly AgentType[];

/** Guest / commercial specialists. */
export const GUEST_COMMERCIAL_AGENT_TYPES = [
  'guest_comms',
  'review_response',
  'ar_collections',
  'deposit_risk',
] as const satisfies readonly AgentType[];

/** All edges exposed by the graph API (revenue only today; ops/guest are peers). */
export const AGENT_GRAPH_EDGES: readonly AgentGraphEdge[] = REVENUE_EDGES;

export function subgraphFor(agentType: AgentType): AgentSubgraph {
  if (
    agentType === 'revenue_manager' ||
    (REVENUE_LEVER_ORDER as readonly string[]).includes(agentType)
  ) {
    return 'revenue';
  }
  if ((OPS_AGENT_TYPES as readonly string[]).includes(agentType)) {
    return 'ops';
  }
  return 'guest_commercial';
}

export function isValidAgentType(agentType: string): agentType is AgentType {
  return (VALID_AGENT_TYPES as readonly string[]).includes(agentType);
}

/**
 * Default external-cron matrix. Revenue levers have no independent cron —
 * they run via RManager. Empty string = manual / event only.
 */
export const DEFAULT_SCHEDULE_MATRIX: Record<
  AgentType,
  { cron: string; notes: string }
> = {
  revenue_manager: {
    cron: '0 6 * * *',
    notes: 'Owns revenue cadence; pulls demand + levers',
  },
  demand_forecast: {
    cron: '',
    notes: 'Via RManager; manual run still allowed',
  },
  pricing: {
    cron: '',
    notes: 'Via RManager; manual run still allowed',
  },
  overbooking: {
    cron: '',
    notes: 'Via RManager; manual run still allowed',
  },
  channel_mix: {
    cron: '',
    notes: 'Via RManager; manual run still allowed',
  },
  group_pickup: {
    cron: '',
    notes: 'Via RManager; manual run still allowed',
  },
  housekeeping: {
    cron: '0 8 * * *',
    notes: 'Daily ops window',
  },
  cancellation: {
    cron: '0 */6 * * *',
    notes: 'Every 6 hours',
  },
  ar_collections: {
    cron: '0 6 * * *',
    notes: 'Daily with RManager window',
  },
  night_audit: {
    cron: '0 23 * * *',
    notes: 'Before night audit close',
  },
  guest_comms: {
    cron: '0 7 * * *',
    notes: 'Daily pre-arrival, day-of, delayed post-stay, win-back; lifecycle events for confirmation/welcome',
  },
  review_response: {
    cron: '',
    notes: 'Event-driven on review ingest + manual',
  },
  deposit_risk: {
    cron: '',
    notes: 'Type reserved; no implementation yet',
  },
};
