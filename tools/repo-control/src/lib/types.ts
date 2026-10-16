/** Repo Control snapshot types (schemaVersion 1). */

export type CheckStatus =
  | 'passed'
  | 'failed'
  | 'not_run'
  | 'unavailable'
  | 'stale'
  | 'timeout';

export type CapabilityStatus =
  | 'verified'
  | 'implemented_unverified'
  | 'partial'
  | 'broken'
  | 'stub_mock'
  | 'planned_only'
  | 'unknown';

export type EvidenceClass = 'fact' | 'heuristic' | 'inference';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Confidence = 'high' | 'medium' | 'low';

export type FindingCategory =
  | 'check_failure'
  | 'incomplete_workflow'
  | 'disconnected_ui'
  | 'disconnected_api'
  | 'placeholder'
  | 'auth_tenancy'
  | 'schema_migration'
  | 'todo'
  | 'bloat'
  | 'duplication'
  | 'complexity'
  | 'other';

export type CollectorStatus = 'ok' | 'failed' | 'timeout' | 'skipped';

export interface Evidence {
  kind: 'file' | 'symbol' | 'command' | 'workflow' | 'url' | 'other';
  path?: string;
  symbol?: string;
  line?: number;
  command?: string;
  summary: string;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  capability: string | null;
  severity: Severity;
  confidence: Confidence;
  evidenceClass: EvidenceClass;
  title: string;
  explanation: string;
  evidence: Evidence[];
  analyzedCommit: string;
  analyzedAt: string;
  suggestedAction: string;
  verificationLimits: string;
  observedFailure?: boolean;
}

export interface CheckResult {
  id: string;
  label: string;
  command: string;
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number | null;
  summary: string;
  evidence: Evidence[];
}

export interface CapabilityResult {
  id: string;
  name: string;
  status: CapabilityStatus;
  exists: string;
  missing: string;
  files: string[];
  routes: string[];
  tests: string[];
  verification: string;
  consequence: string;
}

export interface CollectorResult {
  id: string;
  status: CollectorStatus;
  durationMs: number;
  summary: string;
  error?: string | null;
}

export interface GraphifyInfo {
  status: 'ready' | 'missing' | 'failed' | 'skipped';
  dir: string | null;
  htmlPath: string | null;
  jsonPath: string | null;
  reportPath: string | null;
  nodeCount: number | null;
  edgeCount: number | null;
  summary: string;
}

export interface SnapshotV1 {
  schemaVersion: 1;
  generatedAt: string;
  repoRoot: string;
  configPath: string;
  productSummary: string;
  git: {
    branch: string;
    commit: string;
    shortCommit: string;
    dirty: boolean;
    dirtyPaths: string[];
    analyzedCommit: string;
    analyzedAt: string;
    stale: boolean;
    staleReason: string | null;
  };
  checks: Record<string, CheckResult>;
  capabilities: CapabilityResult[];
  findings: Finding[];
  recentChanges: {
    commits: Array<{
      sha: string;
      subject: string;
      date: string;
      paths: string[];
      capabilities: string[];
    }>;
    uncommitted: string[];
  };
  nextActions: Array<{
    rank: number;
    title: string;
    why: string;
    findingIds: string[];
    confidence: Confidence;
    effortEstimate: string | null;
  }>;
  runtime: {
    status: 'not_connected' | 'connected';
    note: string;
    sources: string[];
  };
  collectors: CollectorResult[];
  graphify: GraphifyInfo;
  manifests: Record<string, unknown>;
  structure: Record<string, unknown>;
  previousSnapshotId: string | null;
  comparison: {
    previousGeneratedAt: string;
    newFindingIds: string[];
    resolvedFindingIds: string[];
    recurringFindingIds: string[];
  } | null;
}

export interface CheckConfig {
  id: string;
  label: string;
  command: string;
  timeoutMs: number;
  enabled?: boolean;
  cwd?: string;
}

export interface CapabilityProbe {
  id: string;
  name: string;
  /** Glob or relative paths that must exist for "implemented" */
  requiredPaths: string[];
  /** Optional paths that strengthen completeness */
  optionalPaths?: string[];
  /** Substrings to find in dashboard App routes / controllers */
  routeHints?: string[];
  /** Paths that indicate tests exist */
  testPaths?: string[];
  /** Paths that indicate stub/mock behavior */
  stubHints?: string[];
  /** Doc-only mentions without code → planned_only when no requiredPaths hit */
  docHints?: string[];
  consequence: string;
}

export interface RuntimeProbeConfig {
  id: string;
  url: string;
}

export interface RepoControlConfig {
  productName: string;
  productSummary: string;
  repoRoot?: string;
  exclusions: string[];
  graphifyDir: string;
  graphifyEnabled: boolean;
  graphifyTimeoutMs: number;
  checks: CheckConfig[];
  capabilities: CapabilityProbe[];
  recentCommitLimit: number;
  todoLimit: number;
  largeFileLineThreshold: number;
  staleAfterMinutes: number;
  /** Public health URLs. Empty means runtime telemetry stays not_connected. */
  runtimeProbes?: RuntimeProbeConfig[];
}
