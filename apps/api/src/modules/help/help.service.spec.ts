import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HelpService } from './help.service';
import { getHelpForRoute, normalizeHelpRoute } from './help-content';

describe('help-content', () => {
  it('normalizes nested reservation routes', () => {
    expect(normalizeHelpRoute('/reservations/calendar')).toBe('/reservations');
    expect(normalizeHelpRoute('/folios/abc')).toBe('/folios');
    expect(normalizeHelpRoute('/')).toBe('/');
  });

  it('returns curated help for known routes', () => {
    const help = getHelpForRoute('/night-audit');
    expect(help?.title).toBe('Night Audit');
    expect(help?.bullets.length).toBeGreaterThan(0);
  });

  it('returns null for unknown routes', () => {
    expect(getHelpForRoute('/not-a-real-page')).toBeNull();
  });

  it('returns stable public copy for night audit', () => {
    const night = getHelpForRoute('/night-audit');
    expect(night?.summary).toMatch(/business day/i);
  });
});

describe('HelpService.explain', () => {
  let llm: { isConfigured: ReturnType<typeof vi.fn>; explain: ReturnType<typeof vi.fn> };
  let service: HelpService;

  beforeEach(() => {
    llm = {
      isConfigured: vi.fn().mockReturnValue(true),
      explain: vi.fn(),
    };
    service = new HelpService(llm as any);
  });

  it('passes only numericPayload numbers to the model', async () => {
    llm.explain.mockResolvedValue({
      rationale: 'Occupancy is 0.7',
      suggestions: [],
      model: 'haip-ai',
    });
    await service.explain('/reports', {
      occupancyRate: 0.7,
      guestName: 'SHOULD_BE_STRIPPED',
      note: 'freeform should not reach model',
    });
    expect(llm.explain).toHaveBeenCalledWith(
      expect.objectContaining({
        numbers: expect.objectContaining({ occupancyRate: 0.7 }),
      }),
    );
    const arg = llm.explain.mock.calls[0][0];
    expect(JSON.stringify(arg.numbers)).not.toContain('SHOULD_BE_STRIPPED');
    expect(JSON.stringify(arg.numbers)).not.toContain('freeform');
  });

  it('returns null explanation when model is off', async () => {
    llm.explain.mockResolvedValue(null);
    const result = await service.explain('/', { occupancyRate: 0.5 });
    expect(result.explanation).toBeNull();
  });

  it('rejects unknown routes', async () => {
    await expect(service.explain('/not-real', {})).rejects.toThrow();
  });
});
