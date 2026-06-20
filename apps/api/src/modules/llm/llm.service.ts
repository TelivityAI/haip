import { Injectable, Logger } from '@nestjs/common';

/**
 * Input for a grounded explanation. The model receives ONLY these structured
 * numbers (already computed by a deterministic agent) — never free-form text it
 * could hallucinate inventory/prices from. `numbers` is the agent's own output.
 */
export interface LlmExplainInput {
  agentType: string;
  decisionType: string;
  /** The deterministic agent's structured output — the ONLY ground truth. */
  numbers: Record<string, unknown>;
}

export interface LlmExplanation {
  rationale: string;
  suggestions: string[];
  model: string;
}

/**
 * HAIP AI client — talks to a LOCAL model via Ollama (the bundled HAIP AI GGUF).
 *
 * Design rules:
 * - **Grounded:** the prompt hands the model only the agent's numbers and tells
 *   it to reason strictly within them. It is a reasoning/explanation layer over
 *   deterministic agents, never a source of new facts.
 * - **Fail-soft:** if no model is configured (no Ollama) or the call/parse fails,
 *   `explain()` returns `null` and callers fall back to showing the raw decision.
 *   The PMS never depends on the model being present.
 *
 * Env:
 * - `OLLAMA_BASE_URL`   (default `http://localhost:11434`)
 * - `HAIP_AI_MODEL`     (default `haip-ai`)
 * - `HAIP_AI_TIMEOUT_MS`(default `10000`) — abort the call after this long
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly baseUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
  private readonly model = process.env['HAIP_AI_MODEL'] ?? 'haip-ai';
  /** Explicit opt-in so the model is never called unless the operator enabled it. */
  private readonly enabled = process.env['HAIP_AI_ENABLED'] === 'true';
  /** Abort a stalled model call so a hung Ollama can't pin a request open. */
  private readonly timeoutMs = (() => {
    const n = Number(process.env['HAIP_AI_TIMEOUT_MS'] ?? '10000');
    return Number.isFinite(n) && n > 0 ? n : 10000;
  })();
  /** Reject absurd response bodies before parsing (a misconfigured/SSRF'd URL). */
  private static readonly MAX_RESPONSE_BYTES = 256 * 1024;

  isConfigured(): boolean {
    return this.enabled;
  }

  /**
   * Produce a grounded rationale + ranked suggestions for one agent decision.
   * Returns `null` (caller falls back) when disabled or on any failure.
   */
  async explain(input: LlmExplainInput): Promise<LlmExplanation | null> {
    if (!this.enabled) return null;

    const system =
      'You are HAIP AI, a hotel revenue & operations analyst. You are given the ' +
      'numeric output of a deterministic decision agent. Explain the decision and ' +
      'suggest improvements using ONLY the numbers provided — never invent figures, ' +
      'rooms, rates, dates, or facts not present. Respond ONLY with compact JSON: ' +
      '{"rationale": string (<=60 words), "suggestions": string[] (0-3 short items)}.';

    const user =
      `Agent: ${input.agentType}\nDecision: ${input.decisionType}\n` +
      `Numbers:\n${JSON.stringify(input.numbers)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: 'json',
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });

      if (!res.ok) {
        this.logger.warn(`HAIP AI call failed (${res.status}) — falling back to raw decision`);
        return null;
      }

      // Best-effort body cap: if the server advertises an oversized body, bail
      // before buffering it. (A lying Content-Length is still bounded by the
      // abort timeout above.)
      const declared = Number(res.headers?.get?.('content-length') ?? '');
      if (Number.isFinite(declared) && declared > LlmService.MAX_RESPONSE_BYTES) {
        this.logger.warn('HAIP AI response too large — falling back to raw decision');
        return null;
      }

      const body = (await res.json()) as { message?: { content?: string } };
      const content = body?.message?.content;
      if (!content) return null;

      const parsed = this.parse(content);
      if (!parsed) {
        this.logger.warn('HAIP AI returned unparseable output — falling back');
        return null;
      }
      return { ...parsed, model: this.model };
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? `timed out after ${this.timeoutMs}ms` : err?.message;
      this.logger.warn(`HAIP AI unreachable (${reason}) — falling back to raw decision`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Defensive JSON parse: tolerate stray prose around the JSON object. */
  private parse(content: string): { rationale: string; suggestions: string[] } | null {
    let raw = content.trim();
    if (!raw.startsWith('{')) {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) return null;
      raw = raw.slice(start, end + 1);
    }
    try {
      const obj = JSON.parse(raw) as { rationale?: unknown; suggestions?: unknown };
      const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';
      if (!rationale) return null;
      const suggestions = Array.isArray(obj.suggestions)
        ? obj.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
        : [];
      return { rationale, suggestions };
    } catch {
      return null;
    }
  }
}
