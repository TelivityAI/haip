import { describe, it, expect } from 'vitest';
import {
  VALID_AGENT_TYPES,
  REVENUE_LEVER_ORDER,
  REVENUE_EDGES,
  AGENT_GRAPH_EDGES,
  DEFAULT_SCHEDULE_MATRIX,
  subgraphFor,
  isValidAgentType,
} from './agent-graph';

describe('agent-graph', () => {
  it('lists 12 specialists + revenue_manager', () => {
    expect(VALID_AGENT_TYPES).toHaveLength(13);
    expect(VALID_AGENT_TYPES).toContain('revenue_manager');
    expect(VALID_AGENT_TYPES).toContain('deposit_risk');
  });

  it('revenue lever order matches RManager gather order', () => {
    expect([...REVENUE_LEVER_ORDER]).toEqual([
      'demand_forecast',
      'pricing',
      'overbooking',
      'channel_mix',
      'group_pickup',
    ]);
  });

  it('revenue edges connect demand → levers → revenue_manager', () => {
    const fromDemand = REVENUE_EDGES.filter((e) => e.from === 'demand_forecast').map((e) => e.to);
    expect(fromDemand.sort()).toEqual(
      ['channel_mix', 'group_pickup', 'overbooking', 'pricing'].sort(),
    );
    const toRm = REVENUE_EDGES.filter((e) => e.to === 'revenue_manager').map((e) => e.from);
    expect(toRm.sort()).toEqual(
      ['channel_mix', 'group_pickup', 'overbooking', 'pricing'].sort(),
    );
    expect(AGENT_GRAPH_EDGES).toEqual(REVENUE_EDGES);
  });

  it('revenue levers have no independent cron (RManager owns cadence)', () => {
    for (const lever of REVENUE_LEVER_ORDER) {
      expect(DEFAULT_SCHEDULE_MATRIX[lever].cron).toBe('');
    }
    expect(DEFAULT_SCHEDULE_MATRIX.revenue_manager.cron).toBe('0 6 * * *');
  });

  it('subgraphFor classifies nodes', () => {
    expect(subgraphFor('pricing')).toBe('revenue');
    expect(subgraphFor('revenue_manager')).toBe('revenue');
    expect(subgraphFor('housekeeping')).toBe('ops');
    expect(subgraphFor('guest_comms')).toBe('guest_commercial');
  });

  it('isValidAgentType guards unknown keys', () => {
    expect(isValidAgentType('pricing')).toBe(true);
    expect(isValidAgentType('not_an_agent')).toBe(false);
  });
});
