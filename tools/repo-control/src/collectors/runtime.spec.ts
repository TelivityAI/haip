import { describe, expect, it } from 'vitest';
import { collectRuntime } from './runtime.js';

describe('collectRuntime', () => {
  it('stays not_connected when no probes are configured', async () => {
    const result = await collectRuntime([]);
    expect(result.data.status).toBe('not_connected');
    expect(result.data.sources).toEqual([]);
    expect(result.collector.status).toBe('skipped');
  });

  it('records observed HTTP status without treating failures as missing telemetry', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('down')) {
        return new Response('no', { status: 502 });
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as typeof fetch;

    const result = await collectRuntime(
      [
        { id: 'up', url: 'https://example.test/health' },
        { id: 'down', url: 'https://down.example.test/health' },
      ],
      fetchImpl,
    );

    expect(result.data.status).toBe('connected');
    expect(result.data.sources[0]).toContain('up HTTP 200');
    expect(result.data.sources[1]).toContain('down HTTP 502');
    expect(result.data.note).toContain('1/2');
    expect(result.data.note).toContain('production database credentials are not configured');
  });
});
