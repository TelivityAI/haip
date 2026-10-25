import { describe, it, expect, vi } from 'vitest';
import { AllowList, staticAllowListSource } from './allow-list.js';

describe('AllowList', () => {
  it('caches search allow-list for ttl then refreshes', async () => {
    let calls = 0;
    const source = {
      listEnabled: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? ['a'] : ['a', 'b'];
      }),
      isEnabled: vi.fn(async (id: string) => id === 'a'),
    };
    const list = new AllowList(source, 50);
    expect(await list.isEnabledCached('a')).toBe(true);
    expect(await list.isEnabledCached('b')).toBe(false);
    expect(source.listEnabled).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(await list.isEnabledCached('b')).toBe(true);
    expect(source.listEnabled).toHaveBeenCalledTimes(2);
  });

  it('live check bypasses cache so disabled properties 404 immediately', async () => {
    const enabled = new Set(['prop-a']);
    const source = {
      listEnabled: async () => [...enabled],
      isEnabled: async (id: string) => enabled.has(id),
    };
    const list = new AllowList(source, 60_000);
    expect(await list.isEnabledCached('prop-a')).toBe(true);
    enabled.delete('prop-a');
    // Cached search still sees it
    expect(await list.isEnabledCached('prop-a')).toBe(true);
    // Live book/detail does not
    expect(await list.isPropertyEnabledLive('prop-a')).toBe(false);
  });

  it('static source filters search results', async () => {
    const list = new AllowList(staticAllowListSource(['p1', 'p2']));
    expect(await list.filterPropertyIds(['p1', 'p3', 'p2'])).toEqual(['p1', 'p2']);
  });
});
