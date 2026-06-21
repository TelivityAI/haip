import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LlmService } from './llm.service';

const INPUT = {
  agentType: 'pricing',
  decisionType: 'rate_adjustment',
  numbers: { occupancy: 0.87, demandLevel: 'peak', recommendedAdjustmentPct: 12 },
};

function makeService(): LlmService {
  // Re-instantiate after env changes so the constructor picks them up.
  return new LlmService();
}

describe('LlmService', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env['HAIP_AI_ENABLED'];
    delete process.env['OLLAMA_BASE_URL'];
    delete process.env['HAIP_AI_MODEL'];
    delete process.env['HAIP_AI_TIMEOUT_MS'];
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('is disabled by default and returns null without calling the model', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    const svc = makeService();
    expect(svc.isConfigured()).toBe(false);
    expect(await svc.explain(INPUT)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a parsed grounded explanation when enabled', async () => {
    process.env['HAIP_AI_ENABLED'] = 'true';
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            rationale: 'Peak demand at 87% occupancy supports a 12% raise.',
            suggestions: ['Set min-LOS 2 on the peak nights', 'Close the lowest rate class'],
          }),
        },
      }),
    } as any);

    const svc = makeService();
    const out = await svc.explain(INPUT);
    expect(out).not.toBeNull();
    expect(out!.rationale).toContain('Peak demand');
    expect(out!.suggestions).toHaveLength(2);
    expect(out!.model).toBe('haip-ai');
  });

  it('falls back to null on a non-OK response', async () => {
    process.env['HAIP_AI_ENABLED'] = 'true';
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({ ok: false, status: 500 } as any);
    expect(await makeService().explain(INPUT)).toBeNull();
  });

  it('falls back to null when the model returns unparseable output', async () => {
    process.env['HAIP_AI_ENABLED'] = 'true';
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'sorry, I cannot do that' } }),
    } as any);
    expect(await makeService().explain(INPUT)).toBeNull();
  });

  it('falls back to null (never throws) when the model is unreachable', async () => {
    process.env['HAIP_AI_ENABLED'] = 'true';
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(makeService().explain(INPUT)).resolves.toBeNull();
  });

  it('aborts and returns null when the model hangs past the timeout', async () => {
    process.env['HAIP_AI_ENABLED'] = 'true';
    process.env['HAIP_AI_TIMEOUT_MS'] = '5';
    // Never resolves on its own — only rejects (AbortError) when the signal fires.
    vi.spyOn(globalThis, 'fetch' as any).mockImplementation(
      (_url: string, opts: any) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );
    await expect(makeService().explain(INPUT)).resolves.toBeNull();
  });

  it('falls back to null when the response body is oversized (Content-Length)', async () => {
    process.env['HAIP_AI_ENABLED'] = 'true';
    const jsonSpy = vi.fn();
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? String(2 * 1024 * 1024) : null) },
      json: jsonSpy,
    } as any);
    expect(await makeService().explain(INPUT)).toBeNull();
    expect(jsonSpy).not.toHaveBeenCalled(); // bailed before buffering the body
  });

  it('extracts JSON even when wrapped in stray prose', async () => {
    process.env['HAIP_AI_ENABLED'] = 'true';
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: 'Here you go:\n{"rationale":"ok","suggestions":[]}\nHope that helps' },
      }),
    } as any);
    const out = await makeService().explain(INPUT);
    expect(out!.rationale).toBe('ok');
    expect(out!.suggestions).toEqual([]);
  });
});
