/**
 * Base interface for all HAIP AI agents.
 *
 * Each agent follows the same lifecycle:
 *   analyze() → recommend() → [approve] → execute() → recordOutcome()
 *
 * Orchestration: RManager chains revenue levers via AgentContext.upstreamResults
 * (see agent-graph.ts). Ops/guest agents use triggeredBy + eventPayload.
 */
export interface HaipAgent {
  readonly agentType: string;

  /** Gather signals and build analysis context. */
  analyze(propertyId: string, context?: AgentContext): Promise<AgentAnalysis>;

  /** Produce recommendations from analysis. */
  recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]>;

  /** Execute an approved (or auto-approved) decision. */
  execute(decision: AgentDecisionRecord): Promise<ExecutionResult>;

  /** Record the actual outcome for a past decision (feedback loop). */
  recordOutcome(decisionId: string, outcome: AgentOutcome): Promise<void>;

  /** Train/retrain the agent's model on historical data. */
  train(propertyId: string): Promise<TrainingResult>;

  /** Return default config for this agent type. */
  getDefaultConfig(): Record<string, unknown>;
}

export interface AgentContext {
  triggeredBy?: 'schedule' | 'manual' | 'event';
  eventPayload?: Record<string, unknown>;
  /**
   * Results from upstream agents in the same orchestration run
   * (keyed by agent type). Populated by RManager for revenue levers.
   */
  upstreamResults?: Record<string, unknown>;
}

export interface AgentAnalysis {
  agentType: string;
  propertyId: string;
  timestamp: Date;
  signals: Record<string, unknown>;
}

export interface AgentDecisionInput {
  decisionType: string;
  recommendation: Record<string, unknown>;
  confidence: number;
  inputSnapshot: Record<string, unknown>;
}

export interface AgentDecisionRecord extends AgentDecisionInput {
  id: string;
  propertyId: string;
  agentType: string;
  status: string;
}

export interface ExecutionResult {
  success: boolean;
  changes: Array<{ entity: string; action: string; detail: string }>;
  error?: string;
}

export interface AgentOutcome {
  actualResult: Record<string, unknown>;
  accuracy?: number;
}

export interface TrainingResult {
  success: boolean;
  dataPoints: number;
  modelVersion: string;
  metrics: Record<string, number>;
}
