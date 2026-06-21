import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AgentService } from './agent.service';
import { WebhookService } from '../webhook/webhook.service';
import { LlmService } from '../llm/llm.service';
import { DRIZZLE } from '../../database/database.module';
import type { HaipAgent, AgentAnalysis, AgentDecisionInput } from './interfaces/haip-agent.interface';

// ---------------------------------------------------------------------------
// Thenable DB mock (matches codebase pattern from housekeeping specs)
// ---------------------------------------------------------------------------

function createMockDb(options: { selectResult?: any; insertResult?: any; updateResult?: any } = {}) {
  const selectResult = options.selectResult ?? [];
  const insertResult = options.insertResult ?? [{}];
  const updateResult = options.updateResult ?? [{}];

  let selectCallCount = 0;
  const selectResults: any[] = Array.isArray(selectResult[0]) ? selectResult : [selectResult];

  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1];
            selectCallCount++;
            resolve(result);
          },
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1];
                selectCallCount++;
                resolve(result);
              },
            }),
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(insertResult),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(updateResult),
          then: (resolve: any) => resolve(updateResult),
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock agent
// ---------------------------------------------------------------------------

function createMockAgent(agentType: string): HaipAgent {
  return {
    agentType,
    analyze: async () => ({
      agentType,
      propertyId: 'prop-1',
      timestamp: new Date(),
      signals: { test: true },
    }),
    recommend: async (): Promise<AgentDecisionInput[]> => [
      {
        decisionType: 'test_decision',
        recommendation: { action: 'test' },
        confidence: 0.75,
        inputSnapshot: { test: true },
      },
    ],
    execute: async () => ({
      success: true,
      changes: [{ entity: 'test', action: 'updated', detail: 'test' }],
    }),
    recordOutcome: async () => {},
    train: async () => ({
      success: true,
      dataPoints: 10,
      modelVersion: 'test-v1',
      metrics: {},
    }),
    getDefaultConfig: () => ({ testKey: 'testValue' }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const existingConfig = {
  id: 'cfg-1',
  propertyId: 'prop-1',
  agentType: 'pricing',
  isEnabled: true,
  mode: 'suggest',
  autopilotConfidenceThreshold: '0.85',
  config: {},
  lastRunAt: null,
  lastTrainedAt: null,
};

const pendingDecision = {
  id: 'dec-1',
  propertyId: 'prop-1',
  agentType: 'pricing',
  decisionType: 'rate_adjustment',
  recommendation: { adjustments: [] },
  confidence: '0.80',
  status: 'pending',
  inputSnapshot: {},
  outcome: null,
};

describe('AgentService', () => {
  // --- registerAgent ---

  it('registers an agent and makes it available', async () => {
    const db = createMockDb({ selectResult: [existingConfig] });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    const agent = createMockAgent('pricing');
    service.registerAgent(agent);
    expect(() => (service as any).getAgentImpl('pricing')).not.toThrow();
  });

  it('throws BadRequestException for unregistered agent', async () => {
    const db = createMockDb({ selectResult: [existingConfig] });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    expect(() => (service as any).getAgentImpl('pricing')).toThrow(BadRequestException);
  });

  // --- validateAgentType ---

  it('rejects invalid agent type', async () => {
    const db = createMockDb();
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    expect(() => (service as any).validateAgentType('invalid_agent')).toThrow(BadRequestException);
  });

  it('accepts valid agent types', async () => {
    const db = createMockDb();
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    for (const type of ['pricing', 'demand_forecast', 'channel_mix', 'overbooking']) {
      expect(() => (service as any).validateAgentType(type)).not.toThrow();
    }
  });

  // --- runAgent ---

  it('skips disabled agents', async () => {
    const disabledConfig = { ...existingConfig, isEnabled: false };
    const db = createMockDb({ selectResult: [disabledConfig] });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);
    service.registerAgent(createMockAgent('pricing'));

    const result = await service.runAgent('prop-1', 'pricing');
    expect(result).toEqual({ skipped: true, reason: 'Agent is disabled' });
  });

  it('runs full agent cycle and emits webhook', async () => {
    const insertedDecision = { id: 'dec-new', decisionType: 'test_decision', confidence: '0.75', status: 'pending' };
    const db = createMockDb({
      selectResult: [existingConfig],
      insertResult: [insertedDecision],
    });
    const mockEmit = vi.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: mockEmit } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);
    service.registerAgent(createMockAgent('pricing'));

    const result = await service.runAgent('prop-1', 'pricing');
    expect(result).toHaveProperty('decisionsCount', 1);
    expect(mockEmit).toHaveBeenCalledWith(
      'agent.run_completed',
      'agent',
      'prop-1',
      expect.objectContaining({ agentType: 'pricing' }),
      'prop-1',
    );
  });

  // --- approveDecision ---

  it('rejects approval of non-pending decision', async () => {
    const approved = { ...pendingDecision, status: 'approved' };
    const db = createMockDb({ selectResult: [approved] });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);
    service.registerAgent(createMockAgent('pricing'));

    await expect(service.approveDecision('prop-1', 'dec-1')).rejects.toThrow(BadRequestException);
  });

  // --- rejectDecision ---

  it('rejects rejection of non-pending decision', async () => {
    const executed = { ...pendingDecision, status: 'auto_executed' };
    const db = createMockDb({ selectResult: [executed] });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    await expect(service.rejectDecision('prop-1', 'dec-1')).rejects.toThrow(BadRequestException);
  });

  // --- getOrCreateConfig ---

  it('returns existing config without creating new one', async () => {
    const db = createMockDb({ selectResult: [existingConfig] });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    const result = await service.getOrCreateConfig('prop-1', 'pricing');
    expect(result).toEqual(existingConfig);
    expect(db.insert).not.toHaveBeenCalled();
  });

  // --- getDecisions ---

  it('throws for invalid agent type on getDecisions', async () => {
    const db = createMockDb();
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    await expect(service.getDecisions('prop-1', 'not_real')).rejects.toThrow(BadRequestException);
  });

  // --- Audit logging ---

  it('writes an audit log row when updateConfig changes a field', async () => {
    const disabledConfig = { ...existingConfig, isEnabled: false };
    const updatedConfig = { ...existingConfig, isEnabled: true };
    const db = createMockDb({
      selectResult: [disabledConfig],
      updateResult: [updatedConfig],
    });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    await service.updateConfig('prop-1', 'pricing', { isEnabled: true }, 'user-42');

    // First insert is the audit row (no other inserts happen in updateConfig).
    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertedValues = (db.insert.mock.results[0]!.value.values as any).mock.calls[0][0];
    expect(insertedValues.action).toBe('update');
    expect(insertedValues.entityType).toBe('agent_config');
    expect(insertedValues.userId).toBe('user-42');
    expect(insertedValues.previousValue).toEqual({ isEnabled: false });
    expect(insertedValues.newValue).toEqual({ isEnabled: true });
  });

  it('skips audit log when updateConfig makes no effective change', async () => {
    // isEnabled already true, update passes the same value
    const db = createMockDb({
      selectResult: [existingConfig],
      updateResult: [existingConfig],
    });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    await service.updateConfig('prop-1', 'pricing', { isEnabled: true });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('writes an audit log row when rejectDecision is called', async () => {
    const db = createMockDb({
      selectResult: [pendingDecision],
      updateResult: [{ ...pendingDecision, status: 'rejected' }],
    });
    const module = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: { emit: vi.fn() } },
        { provide: LlmService, useValue: { explain: vi.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    const service = module.get(AgentService);

    await service.rejectDecision('prop-1', 'dec-1', 'user-99', 'not confident');

    expect(db.insert).toHaveBeenCalledTimes(1);
    const insertedValues = (db.insert.mock.results[0]!.value.values as any).mock.calls[0][0];
    expect(insertedValues.entityType).toBe('agent_decision');
    expect(insertedValues.userId).toBe('user-99');
    expect(insertedValues.newValue).toMatchObject({ status: 'rejected', reason: 'not confident' });
  });

  // --- getPerformance logic ---

  it('calculates performance metrics correctly', () => {
    const decisions = [
      { status: 'approved', confidence: '0.80', outcome: { revenue: 500 } },
      { status: 'auto_executed', confidence: '0.90', outcome: null },
      { status: 'rejected', confidence: '0.60', outcome: null },
    ];

    const total = decisions.length;
    const approved = decisions.filter((d) => d.status === 'approved' || d.status === 'auto_executed');
    const rejected = decisions.filter((d) => d.status === 'rejected');
    const autoExecuted = decisions.filter((d) => d.status === 'auto_executed');
    const withOutcome = decisions.filter((d) => d.outcome !== null);
    const avgConfidence = decisions.reduce((sum, d) => sum + parseFloat(d.confidence), 0) / total;

    expect(total).toBe(3);
    expect(approved.length).toBe(2);
    expect(rejected.length).toBe(1);
    expect(autoExecuted.length).toBe(1);
    expect(withOutcome.length).toBe(1);
    expect(avgConfidence).toBeCloseTo(0.77, 1);
    expect(Math.round((approved.length / total) * 100)).toBe(67);
  });
});
