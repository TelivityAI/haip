import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { WebhookService } from '../webhook/webhook.service';
import { LlmService } from '../llm/llm.service';
import { DRIZZLE } from '../../database/database.module';

const PROPERTY = '11111111-1111-1111-1111-111111111111';

function mockDb(configRow: any) {
  const setSpy = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ then: (r: any) => r([{}]) }) });
  const db = {
    update: vi.fn().mockReturnValue({ set: setSpy }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ then: (r: any) => r([configRow]) }) }),
    }),
  };
  return { db, setSpy };
}

async function build(configRow: any) {
  const { db, setSpy } = mockDb(configRow);
  const moduleRef = await Test.createTestingModule({
    providers: [
      AgentService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      { provide: LlmService, useValue: { explain: vi.fn() } },
    ],
  }).compile();
  return { svc: moduleRef.get(AgentService), db, setSpy };
}

describe('AgentService.trainAgent', () => {
  it('runs the agent train() and persists learned params into modelState + lastTrainedAt', async () => {
    const { svc, db, setSpy } = await build({ id: 'cfg-1', propertyId: PROPERTY, agentType: 'cancellation' });

    const train = vi.fn().mockResolvedValue({
      success: true,
      dataPoints: 120,
      modelVersion: 'cancellation-predictor-v2',
      metrics: { ota: 0.42, direct: 0.05 },
    });
    // Register a minimal agent impl.
    svc.registerAgent({
      agentType: 'cancellation',
      train,
      analyze: vi.fn(),
      recommend: vi.fn(),
      execute: vi.fn(),
      recordOutcome: vi.fn(),
      getDefaultConfig: () => ({}),
    } as any);

    const result = await svc.trainAgent(PROPERTY, 'cancellation');

    expect(train).toHaveBeenCalledWith(PROPERTY);
    expect(db.update).toHaveBeenCalledOnce();
    const setArg = setSpy.mock.calls[0][0];
    expect(setArg.modelState.learned).toEqual({ ota: 0.42, direct: 0.05 });
    expect(setArg.modelState.dataPoints).toBe(120);
    expect(setArg.lastTrainedAt).toBeInstanceOf(Date);
    expect(result.dataPoints).toBe(120);
  });
});
