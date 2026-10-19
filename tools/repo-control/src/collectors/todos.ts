import path from 'node:path';
import type { CollectorResult, Finding, RepoControlConfig } from '../lib/types.js';
import { walkFiles, readText } from '../lib/fs-walk.js';

const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]?(.*)$/i;

export async function collectTodos(
  config: RepoControlConfig,
  analyzedCommit: string,
  analyzedAt: string,
): Promise<{ findings: Finding[]; collector: CollectorResult }> {
  const started = Date.now();
  const root = config.repoRoot!;
  try {
    const files = walkFiles(root, config.exclusions, {
      maxFiles: 15_000,
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md'],
    });
    const findings: Finding[] = [];
    let n = 0;

    for (const rel of files) {
      if (findings.length >= config.todoLimit) break;
      // skip this tool's own sources to reduce noise
      if (rel.startsWith('tools/repo-control/')) continue;
      const text = readText(path.join(root, rel));
      if (!text) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (findings.length >= config.todoLimit) break;
        const m = TODO_RE.exec(lines[i]);
        if (!m) continue;
        n += 1;
        const kind = m[1].toUpperCase();
        const detail = (m[2] || '').trim().slice(0, 160);
        findings.push({
          id: `todo-${hashId(rel, i + 1, kind)}`,
          category: 'todo',
          capability: null,
          severity: kind === 'FIXME' ? 'high' : 'low',
          confidence: 'high',
          evidenceClass: 'fact',
          title: `${kind} in ${rel}:${i + 1}`,
          explanation: detail || `${kind} marker without trailing text`,
          evidence: [
            {
              kind: 'file',
              path: rel,
              line: i + 1,
              summary: lines[i].trim().slice(0, 200),
            },
          ],
          analyzedCommit,
          analyzedAt,
          suggestedAction: 'Triage whether this marker blocks a critical workflow; fix or remove.',
          verificationLimits: 'Comment presence only — surrounding behavior was not executed.',
          observedFailure: false,
        });
      }
    }

    return {
      findings,
      collector: {
        id: 'todos',
        status: 'ok',
        durationMs: Date.now() - started,
        summary: `${findings.length} TODO/FIXME markers (scanned limit ${config.todoLimit}; raw hits ≥ ${n})`,
      },
    };
  } catch (err) {
    return {
      findings: [],
      collector: {
        id: 'todos',
        status: 'failed',
        durationMs: Date.now() - started,
        summary: 'todo collector failed',
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function hashId(...parts: Array<string | number>): string {
  const s = parts.join('|');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
