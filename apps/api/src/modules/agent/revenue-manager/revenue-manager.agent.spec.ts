import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '../../../database/database.module';
import { AgentService } from '../agent.service';
import { REVENUE_LEVER_ORDER } from '../agent-graph';
import { DemandForecastAgent } from '../demand/demand.agent';
import { DynamicPricingAgent } from '../pricing/pricing.agent';
import { OverbookingAgent } from '../overbooking/overbooking.agent';
import { ChannelMixAgent } from '../channel-mix/channel-mix.agent';
import { GroupPickupAgent } from '../group-pickup/group-pickup.agent';
import { RevenueManagerAgent } from './revenue-manager.agent';

function mockLever(agentType: string, recommendPayload: Record<string, unknown>) {
  return {
    agentType,
    analyze: vi.fn().mockResolvedValue({
      agentType,
      propertyId: 'prop-1',
      timestamp: new Date(),
      signals: {},
    }),
    recommend: vi.fn().mockResolvedValue([
      {
        decisionType: `${agentType}_rec`,
        recommendation: recommendPayload,
        confidence: 0.8,
        inputSnapshot: {},
      },
    ]),
  };
}

describe('RevenueManagerAgent', () => {
  let agent: RevenueManagerAgent;
  const demand = mockLever('demand_forecast', {
    forecasts: [
      { date: '2026-08-01', predictedOccupancy: 0.7, confidence: 0.9 },
      { date: '2026-08-02', predictedOccupancy: 0.4, confidence: 0.85 },
    ],
  });
  const pricing = mockLever('pricing', {
    adjustments: [{ date: '2026-08-01', adjustmentPct: 5 }],
  });
  const overbooking = mockLever('overbooking', { level: 2 });
  const channelMix = mockLever('channel_mix', { shift: 'direct' });
  const groupPickup = mockLever('group_pickup', { release: 1 });

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevenueManagerAgent,
        { provide: DRIZZLE, useValue: { select: vi.fn() } },
        {
          provide: AgentService,
          useValue: {
            registerAgent: vi.fn(),
            getOrCreateConfig: vi.fn().mockResolvedValue({
              config: { objective: 'goppar', horizonDays: 30, baselineAdr: 150 },
            }),
          },
        },
        { provide: DemandForecastAgent, useValue: demand },
        { provide: DynamicPricingAgent, useValue: pricing },
        { provide: OverbookingAgent, useValue: overbooking },
        { provide: ChannelMixAgent, useValue: channelMix },
        { provide: GroupPickupAgent, useValue: groupPickup },
      ],
    }).compile();
    agent = module.get(RevenueManagerAgent);
  });

  it('runs levers in REVENUE_LEVER_ORDER and passes upstreamResults', async () => {
    const analysis = await agent.analyze('prop-1', { triggeredBy: 'manual' });

    const callOrder = [
      demand.analyze,
      pricing.analyze,
      overbooking.analyze,
      channelMix.analyze,
      groupPickup.analyze,
    ].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(callOrder).toEqual([...callOrder].sort((a, b) => a - b));
    expect([...REVENUE_LEVER_ORDER]).toEqual([
      'demand_forecast',
      'pricing',
      'overbooking',
      'channel_mix',
      'group_pickup',
    ]);

    // Pricing sees demand in upstreamResults
    const pricingCtx = pricing.analyze.mock.calls[0][1];
    expect(pricingCtx.upstreamResults).toMatchObject({
      demand_forecast: { available: true },
    });

    // Later lever sees prior upstream
    const gpCtx = groupPickup.analyze.mock.calls[0][1];
    expect(gpCtx.upstreamResults.demand_forecast.available).toBe(true);
    expect(gpCtx.upstreamResults.pricing.available).toBe(true);
    expect(gpCtx.upstreamResults.overbooking.available).toBe(true);
    expect(gpCtx.upstreamResults.channel_mix.available).toBe(true);

    expect(analysis.signals.upstreamResults).toBeDefined();
    expect((analysis.signals as any).forecasts).toHaveLength(2);
  });

  it('continues when one lever fails', async () => {
    overbooking.analyze.mockRejectedValueOnce(new Error('boom'));
    const analysis = await agent.analyze('prop-1');
    expect((analysis.signals as any).leverSummaries.overbooking).toEqual({ available: false });
    expect((analysis.signals as any).leverSummaries.channelMix.available).toBe(true);
    expect(channelMix.analyze).toHaveBeenCalled();
    expect(groupPickup.analyze).toHaveBeenCalled();
  });

  it('recommend embeds lever order and upstream in decision', async () => {
    const analysis = await agent.analyze('prop-1');
    const decisions = await agent.recommend(analysis);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.inputSnapshot.revenueLeverOrder).toEqual([...REVENUE_LEVER_ORDER]);
    expect(decisions[0]!.recommendation.upstreamResults).toBeDefined();
  });
});
