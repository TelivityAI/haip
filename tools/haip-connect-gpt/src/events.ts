/**
 * Tool-call logging to the haip-demo Supabase project (table: haip_tool_calls).
 *
 * Writes via a direct Postgres connection (postgres-js) using TOOL_LOG_DATABASE_URL,
 * so the gateway needs no Supabase service-role key. Logging is best-effort: a
 * failure here (or a missing URL) never breaks the action response the GPT is
 * waiting on.
 *
 * Callers MUST pass already-scrubbed request/response payloads (see scrub.ts).
 */

import postgres from 'postgres';

export interface ToolCallLog {
  tool: string;
  sessionId: string | null;
  request: unknown;
  response: unknown;
  status: 'ok' | 'error';
  error?: string | null;
  latencyMs: number;
}

let sql: ReturnType<typeof postgres> | null = null;

const url = process.env['TOOL_LOG_DATABASE_URL'];

if (url) {
  // Small pool: logging is fire-and-forget and must never starve the action path.
  sql = postgres(url, { max: 2, connect_timeout: 10 });
} else {
  // Surfaced once at startup so an operator notices logging is off in production.
  console.warn('[events] TOOL_LOG_DATABASE_URL not set — tool-call logging is disabled.');
}

export function isLoggingEnabled(): boolean {
  return sql !== null;
}

export async function logToolCall(entry: ToolCallLog): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      insert into haip_tool_calls (tool, session_id, request, response, status, error, latency_ms)
      values (
        ${entry.tool},
        ${entry.sessionId},
        ${sql.json(entry.request as never)},
        ${sql.json(entry.response as never)},
        ${entry.status},
        ${entry.error ?? null},
        ${entry.latencyMs}
      )
    `;
  } catch (err) {
    console.warn('[events] failed to log tool call:', (err as Error).message);
  }
}
