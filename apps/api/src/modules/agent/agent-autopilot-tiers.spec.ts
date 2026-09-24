import { describe, it, expect } from 'vitest';
import {
  autopilotRiskTier,
  shouldAutoExecuteDecision,
  MONEY_AUTOPILOT_FLOOR,
} from './agent-autopilot-tiers';

describe('autopilotRiskTier', () => {
  it('classifies money-moving agents', () => {
    expect(autopilotRiskTier('pricing')).toBe('money');
    expect(autopilotRiskTier('overbooking')).toBe('money');
    expect(autopilotRiskTier('channel_mix')).toBe('money');
    expect(autopilotRiskTier('revenue_manager')).toBe('money');
    expect(autopilotRiskTier('group_pickup')).toBe('money');
  });

  it('classifies guest-facing agents', () => {
    expect(autopilotRiskTier('guest_comms')).toBe('guest');
    expect(autopilotRiskTier('review_response')).toBe('guest');
  });

  it('classifies remaining agents as ops', () => {
    expect(autopilotRiskTier('demand_forecast')).toBe('ops');
    expect(autopilotRiskTier('night_audit')).toBe('ops');
    expect(autopilotRiskTier('housekeeping')).toBe('ops');
    expect(autopilotRiskTier('cancellation')).toBe('ops');
    expect(autopilotRiskTier('ar_collections')).toBe('ops');
    expect(autopilotRiskTier('deposit_risk')).toBe('ops');
  });
});

describe('shouldAutoExecuteDecision', () => {
  it('never auto-executes outside autopilot mode', () => {
    expect(
      shouldAutoExecuteDecision({
        mode: 'suggest',
        agentType: 'pricing',
        confidence: 0.99,
        configThreshold: 0.85,
      }),
    ).toBe(false);
  });

  it('never auto-executes guest-facing agents even at high confidence', () => {
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'review_response',
        confidence: 0.99,
        configThreshold: 0.5,
      }),
    ).toBe(false);
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'guest_comms',
        confidence: 0.99,
        configThreshold: 0.5,
      }),
    ).toBe(false);
  });

  it('requires money agents to clear the money floor even if config is lower', () => {
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'pricing',
        confidence: 0.9,
        configThreshold: 0.85,
      }),
    ).toBe(false);
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'pricing',
        confidence: MONEY_AUTOPILOT_FLOOR,
        configThreshold: 0.85,
      }),
    ).toBe(true);
  });

  it('respects a config threshold above the money floor', () => {
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'overbooking',
        confidence: 0.93,
        configThreshold: 0.95,
      }),
    ).toBe(false);
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'overbooking',
        confidence: 0.95,
        configThreshold: 0.95,
      }),
    ).toBe(true);
  });

  it('uses the config threshold alone for ops agents', () => {
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'demand_forecast',
        confidence: 0.85,
        configThreshold: 0.85,
      }),
    ).toBe(true);
    expect(
      shouldAutoExecuteDecision({
        mode: 'autopilot',
        agentType: 'night_audit',
        confidence: 0.84,
        configThreshold: 0.85,
      }),
    ).toBe(false);
  });
});
