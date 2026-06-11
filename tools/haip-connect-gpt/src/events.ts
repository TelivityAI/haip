/**
 * Tool-call logging to Supabase (project: ligare, table: haip_tool_calls).
 *
 * Mirrors the OTAIP/Ligare `ligare_tool_calls` schema so both products' training
 * data lives in the same Supabase project. Logging is best-effort: a failure here
 * (or missing credentials) never breaks the action response the GPT is waiting on.
 *
 * Callers MUST pass already-scrubbed request/response payloads (see scrub.ts).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface ToolCallLog {
  tool: string;
  sessionId: string | null;
  request: unknown;
  response: unknown;
  status: 'ok' | 'error';
  error?: string | null;
  latencyMs: number;
}

let client: SupabaseClient | null = null;

const url = process.env['SUPABASE_URL'];
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (url && serviceRoleKey) {
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
} else {
  // Surfaced once at startup so an operator notices logging is off in production.
  console.warn(
    '[events] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — tool-call logging is disabled.',
  );
}

export function isLoggingEnabled(): boolean {
  return client !== null;
}

export async function logToolCall(entry: ToolCallLog): Promise<void> {
  if (!client) return;
  try {
    const { error } = await client.from('haip_tool_calls').insert({
      tool: entry.tool,
      session_id: entry.sessionId,
      request: entry.request,
      response: entry.response,
      status: entry.status,
      error: entry.error ?? null,
      latency_ms: entry.latencyMs,
    });
    if (error) {
      console.warn('[events] failed to log tool call:', error.message);
    }
  } catch (err) {
    console.warn('[events] failed to log tool call:', (err as Error).message);
  }
}
