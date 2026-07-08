import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { agentConfigs, agentDecisions, agentTrainingSnapshots, auditLogs } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { LlmService } from '../llm/llm.service';
import { groundExplanation, numericPayload } from '../llm/grounding';
import type {
  HaipAgent,
  AgentContext,
  AgentDecisionRecord,
  AgentOutcome,
} from './interfaces/haip-agent.interface';

const VALID_AGENT_TYPES = [
  'pricing', 'demand_forecast', 'channel_mix', 'overbooking',
  'night_audit', 'housekeeping', 'cancellation', 'guest_comms', 'review_response',
  'ar_collections', 'deposit_risk', 'group_pickup', 'revenue_manager',
];

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private agents: Map<string, HaipAgent> = new Map();

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Generate (or return cached) HAIP AI explanation + suggestions for one decision.
   * Grounded: the model sees ONLY the decision's recommendation numbers. On-demand
   * so the model is invoked only for decisions a human actually reviews; the result
   * is cached on `agent_decisions.explanation`.
   *
   * Returns `{ explanation: null, model: null }` when the model is disabled or
   * unavailable — callers fall back to showing the raw decision.
   */
  async explainDecision(propertyId: string, decisionId: string, force = false) {
    const decision = await this.getDecisionById(decisionId, propertyId);

    const cached = decision.explanation as
      | { rationale: string; suggestions: string[]; model: string }
      | null;
    if (cached && !force) {
      return { explanation: cached, model: cached.model, fromCache: true };
    }

    const numbers = (decision.recommendation ?? {}) as Record<string, unknown>;
    // Strip every free-form string to numeric leaves before the prompt: the
    // model must see ONLY numbers, never attacker-influenced text (guest names,
    // review/email bodies) that could inject instructions into the explanation.
    const promptNumbers = (numericPayload(numbers) ?? {}) as Record<string, unknown>;
    const result = await this.llm.explain({
      agentType: decision.agentType,
      decisionType: decision.decisionType,
      // The deterministic agent's own numeric output is the ONLY ground truth.
      numbers: promptNumbers,
    });

    if (!result) {
      return { explanation: null, model: null, fromCache: false };
    }

    // Anti-hallucination guard: drop suggestions asserting figures the agent's
    // numbers don't support, and flag the rationale if it does. (Execution itself
    // never uses this text — approval runs the agent's own recommendation.)
    const guarded = groundExplanation(numbers, result);

    // Fail closed: if the rationale asserts a figure the decision doesn't
    // support, suppress the whole explanation rather than displaying (or
    // caching) a labelled hallucination. Caller falls back to the raw decision.
    if (!guarded.grounded) {
      this.logger.warn(
        `HAIP AI rationale failed grounding for decision ${decisionId} — suppressed`,
      );
      return { explanation: null, model: null, fromCache: false };
    }

    const explanation = { ...guarded, model: result.model };

    await this.db
      .update(agentDecisions)
      .set({ explanation })
      .where(and(eq(agentDecisions.id, decisionId), eq(agentDecisions.propertyId, propertyId)));

    return { explanation, model: result.model, fromCache: false };
  }

  /** Register an agent implementation. Called by sub-agents on init. */
  registerAgent(agent: HaipAgent) {
    this.agents.set(agent.agentType, agent);
  }

  /**
   * Run a full agent cycle: analyze → recommend → store decisions.
   * If autopilot enabled and confidence meets threshold, auto-execute.
   */
  async runAgent(propertyId: string, agentType: string, context?: AgentContext) {
    const agent = this.getAgentImpl(agentType);
    const config = await this.getOrCreateConfig(propertyId, agentType);

    if (!config.isEnabled) {
      return { skipped: true, reason: 'Agent is disabled' };
    }

    // 1. Analyze
    const analysis = await agent.analyze(propertyId, context);

    // 2. Recommend
    const recommendations = await agent.recommend(analysis);

    // 3. Store decisions
    const decisions: any[] = [];
    const threshold = parseFloat(config.autopilotConfidenceThreshold ?? '0.85');

    for (const rec of recommendations) {
      const shouldAutoExecute =
        config.mode === 'autopilot' && rec.confidence >= threshold;

      // Always insert as pending first — update to auto_executed only on success
      const [decision] = await this.db
        .insert(agentDecisions)
        .values({
          propertyId,
          agentType: agentType as any,
          decisionType: rec.decisionType,
          inputSnapshot: rec.inputSnapshot,
          recommendation: rec.recommendation,
          confidence: rec.confidence.toFixed(2),
          status: 'pending',
        })
        .returning();

      // Auto-execute if in autopilot mode
      if (shouldAutoExecute) {
        try {
          await agent.execute({
            ...rec,
            id: decision.id,
            propertyId,
            agentType,
            status: 'auto_executed',
          });
          // Mark as auto_executed only on success
          await this.db
            .update(agentDecisions)
            .set({ status: 'auto_executed', executedAt: new Date() })
            .where(eq(agentDecisions.id, decision.id));
          decision.status = 'auto_executed';
        } catch (error: any) {
          // Mark as failed with error details
          await this.db
            .update(agentDecisions)
            .set({
              status: 'rejected',
              outcome: { error: error.message ?? 'Execution failed', autoExecutionFailed: true },
            })
            .where(eq(agentDecisions.id, decision.id));
          decision.status = 'rejected';
        }
      }

      decisions.push(decision);

      await this.webhookService.emit(
        'agent.decision_created',
        'agent_decision',
        decision.id,
        {
          agentType,
          decisionType: rec.decisionType,
          confidence: rec.confidence,
          summary: rec.recommendation?.summary ?? rec.decisionType,
        },
        propertyId,
      );
    }

    // Update last run timestamp
    await this.db
      .update(agentConfigs)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(agentConfigs.propertyId, propertyId),
          eq(agentConfigs.agentType, agentType as any),
        ),
      );

    await this.webhookService.emit(
      'agent.run_completed',
      'agent',
      propertyId,
      { agentType, decisionsCount: decisions.length },
      propertyId,
    );

    return {
      agentType,
      decisionsCount: decisions.length,
      decisions: decisions.map((d: any) => ({
        id: d.id,
        decisionType: d.decisionType,
        confidence: d.confidence,
        status: d.status,
      })),
    };
  }

  /** Approve a pending decision and execute it. */
  async approveDecision(propertyId: string, decisionId: string, userId?: string) {
    const decision = await this.getDecisionById(decisionId, propertyId);

    if (decision.status !== 'pending') {
      throw new BadRequestException(`Decision is ${decision.status}, cannot approve`);
    }

    const agent = this.getAgentImpl(decision.agentType);

    // Execute
    const result = await agent.execute({
      id: decision.id,
      propertyId,
      agentType: decision.agentType,
      decisionType: decision.decisionType,
      recommendation: decision.recommendation,
      confidence: parseFloat(decision.confidence),
      inputSnapshot: decision.inputSnapshot,
      status: 'approved',
    });

    // Update status
    const [updated] = await this.db
      .update(agentDecisions)
      .set({
        status: 'approved',
        approvedBy: userId ?? null,
        executedAt: new Date(),
      })
      .where(eq(agentDecisions.id, decisionId))
      .returning();

    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'agent_decision',
      entityId: decisionId,
      userId: userId ?? null,
      previousValue: { status: 'pending' },
      newValue: { status: 'approved', agentType: decision.agentType, decisionType: decision.decisionType },
      description: `Agent decision approved and executed: ${decision.agentType}/${decision.decisionType}`,
    });

    await this.webhookService.emit(
      'agent.decision_executed',
      'agent_decision',
      decisionId,
      { agentType: decision.agentType, decisionType: decision.decisionType },
      propertyId,
    );

    return { decision: updated, execution: result };
  }

  /** Reject a pending decision. */
  async rejectDecision(propertyId: string, decisionId: string, userId?: string, reason?: string) {
    const decision = await this.getDecisionById(decisionId, propertyId);

    if (decision.status !== 'pending') {
      throw new BadRequestException(`Decision is ${decision.status}, cannot reject`);
    }

    const [updated] = await this.db
      .update(agentDecisions)
      .set({
        status: 'rejected',
        approvedBy: userId ?? null,
        outcome: reason ? { rejectionReason: reason } : null,
      })
      .where(eq(agentDecisions.id, decisionId))
      .returning();

    await this.db.insert(auditLogs).values({
      propertyId,
      action: 'update',
      entityType: 'agent_decision',
      entityId: decisionId,
      userId: userId ?? null,
      previousValue: { status: 'pending' },
      newValue: { status: 'rejected', reason: reason ?? null },
      description: `Agent decision rejected: ${decision.agentType}/${decision.decisionType}`,
    });

    return updated;
  }

  /** Record actual outcome for a past decision (feedback loop). */
  async recordOutcome(propertyId: string, decisionId: string, outcome: AgentOutcome) {
    const decision = await this.getDecisionById(decisionId, propertyId);
    const agent = this.agents.get(decision.agentType);

    await this.db
      .update(agentDecisions)
      .set({
        outcome: outcome.actualResult,
        outcomeRecordedAt: new Date(),
      })
      .where(eq(agentDecisions.id, decisionId));

    if (agent) {
      await agent.recordOutcome(decisionId, outcome);
    }
  }

  /** Get or create agent config for a property. Uses upsert to prevent race conditions. */
  async getOrCreateConfig(propertyId: string, agentType: string) {
    this.validateAgentType(agentType);

    const [existing] = await this.db
      .select()
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.propertyId, propertyId),
          eq(agentConfigs.agentType, agentType as any),
        ),
      );

    if (existing) return existing;

    // Create default config using onConflictDoNothing to handle race conditions
    const agent = this.agents.get(agentType);
    const defaultConfig = agent?.getDefaultConfig() ?? {};

    await this.db
      .insert(agentConfigs)
      .values({
        propertyId,
        agentType: agentType as any,
        isEnabled: false,
        mode: 'suggest',
        config: defaultConfig,
      })
      .onConflictDoNothing();

    // Re-fetch to get the row (whether we created it or someone else did)
    const [config] = await this.db
      .select()
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.propertyId, propertyId),
          eq(agentConfigs.agentType, agentType as any),
        ),
      );

    return config;
  }

  /** Update agent config — writes an audit log row describing the diff. */
  async updateConfig(
    propertyId: string,
    agentType: string,
    updates: Record<string, unknown>,
    userId?: string,
  ) {
    const config = await this.getOrCreateConfig(propertyId, agentType);

    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updates['isEnabled'] !== undefined) setValues['isEnabled'] = updates['isEnabled'];
    if (updates['mode'] !== undefined) setValues['mode'] = updates['mode'];
    if (updates['autopilotConfidenceThreshold'] !== undefined)
      setValues['autopilotConfidenceThreshold'] = String(updates['autopilotConfidenceThreshold']);
    if (updates['config'] !== undefined) setValues['config'] = updates['config'];

    const [updated] = await this.db
      .update(agentConfigs)
      .set(setValues)
      .where(eq(agentConfigs.id, config.id))
      .returning();

    // Build diff of the fields the user actually changed (sensitive config only).
    const auditFields = ['isEnabled', 'mode', 'autopilotConfidenceThreshold', 'config'];
    const diff: Record<string, { old: unknown; new: unknown }> = {};
    for (const field of auditFields) {
      if (updates[field] === undefined) continue;
      const oldValue = (config as any)[field];
      const newValue = (updated as any)[field];
      // Only record if actually changed (string-compare to handle numeric thresholds).
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        diff[field] = { old: oldValue, new: newValue };
      }
    }

    if (Object.keys(diff).length > 0) {
      await this.db.insert(auditLogs).values({
        propertyId,
        action: 'update',
        entityType: 'agent_config',
        entityId: config.id,
        userId: userId ?? null,
        previousValue: Object.fromEntries(
          Object.entries(diff).map(([k, v]) => [k, v.old]),
        ),
        newValue: Object.fromEntries(
          Object.entries(diff).map(([k, v]) => [k, v.new]),
        ),
        description: `Agent config updated: ${agentType} (${Object.keys(diff).join(', ')})`,
      });
    }

    return updated;
  }

  /** List all agent statuses for a property. */
  async listAgentStatuses(propertyId: string) {
    const statuses = [];

    for (const agentType of VALID_AGENT_TYPES) {
      const config = await this.getOrCreateConfig(propertyId, agentType);

      // Count recent decisions
      const recentDecisions = await this.db
        .select()
        .from(agentDecisions)
        .where(
          and(
            eq(agentDecisions.propertyId, propertyId),
            eq(agentDecisions.agentType, agentType as any),
          ),
        )
        .orderBy(desc(agentDecisions.createdAt))
        .limit(5);

      const pendingCount = recentDecisions.filter((d: any) => d.status === 'pending').length;

      statuses.push({
        agentType,
        isEnabled: config.isEnabled,
        mode: config.mode,
        lastRunAt: config.lastRunAt,
        lastTrainedAt: config.lastTrainedAt,
        pendingDecisions: pendingCount,
        hasImplementation: this.agents.has(agentType),
      });
    }

    return statuses;
  }

  /** Get decision history for an agent. */
  async getDecisions(propertyId: string, agentType: string, limit = 50) {
    this.validateAgentType(agentType);

    return this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.propertyId, propertyId),
          eq(agentDecisions.agentType, agentType as any),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit);
  }

  /**
   * Train one agent on this property's own history. The agent computes its
   * calibrated parameters; we persist them into `agent_configs.modelState.learned`
   * and stamp `lastTrainedAt`. `analyze()` then uses the learned params instead of
   * the cold-start defaults — the real per-property learning loop.
   */
  async trainAgent(propertyId: string, agentType: string) {
    this.validateAgentType(agentType);
    const agent = this.getAgentImpl(agentType);
    const config = await this.getOrCreateConfig(propertyId, agentType);

    const result = await agent.train(propertyId);

    await this.db
      .update(agentConfigs)
      .set({
        modelState: {
          learned: result.metrics ?? {},
          modelVersion: result.modelVersion,
          dataPoints: result.dataPoints,
          trainedAt: new Date().toISOString(),
        },
        lastTrainedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentConfigs.id, config.id));

    return result;
  }

  /** Train every enabled agent for a property (the nightly job hits this). */
  async trainAll(propertyId: string) {
    const configs = await this.db
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.propertyId, propertyId), eq(agentConfigs.isEnabled, true)));

    const results: Array<{ agentType: string; success: boolean; dataPoints?: number; error?: string }> = [];
    for (const c of configs) {
      if (!this.agents.has(c.agentType)) continue;
      try {
        const r = await this.trainAgent(propertyId, c.agentType);
        results.push({ agentType: c.agentType, success: r.success, dataPoints: r.dataPoints });
      } catch (e: any) {
        results.push({ agentType: c.agentType, success: false, error: e?.message });
      }
    }
    return { trained: results.length, results };
  }

  /** Get agent performance metrics. */
  async getPerformance(propertyId: string, agentType: string) {
    this.validateAgentType(agentType);

    const decisions = await this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.propertyId, propertyId),
          eq(agentDecisions.agentType, agentType as any),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt))
      .limit(200);

    const total = decisions.length;
    const withOutcome = decisions.filter((d: any) => d.outcome !== null);
    const approved = decisions.filter((d: any) => d.status === 'approved' || d.status === 'auto_executed');
    const rejected = decisions.filter((d: any) => d.status === 'rejected');

    // Calculate average confidence
    const avgConfidence = total > 0
      ? decisions.reduce((sum: number, d: any) => sum + parseFloat(d.confidence), 0) / total
      : 0;

    return {
      agentType,
      totalDecisions: total,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      autoExecutedCount: decisions.filter((d: any) => d.status === 'auto_executed').length,
      outcomeCount: withOutcome.length,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
      approvalRate: total > 0 ? Math.round((approved.length / total) * 100) : 0,
    };
  }

  // --- Private ---

  private getAgentImpl(agentType: string): HaipAgent {
    this.validateAgentType(agentType);
    const agent = this.agents.get(agentType);
    if (!agent) {
      throw new BadRequestException(`Agent '${agentType}' is not implemented yet`);
    }
    return agent;
  }

  private async getDecisionById(decisionId: string, propertyId: string) {
    const [decision] = await this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.id, decisionId),
          eq(agentDecisions.propertyId, propertyId),
        ),
      );

    if (!decision) {
      throw new NotFoundException(`Decision ${decisionId} not found`);
    }
    return decision;
  }

  private validateAgentType(agentType: string) {
    if (!VALID_AGENT_TYPES.includes(agentType)) {
      throw new BadRequestException(
        `Invalid agent type: '${agentType}'. Valid: ${VALID_AGENT_TYPES.join(', ')}`,
      );
    }
  }
}
