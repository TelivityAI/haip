import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('./api', () => ({ api: mocks }));
import { icalApi, validCalendarUrl } from './ical';
beforeEach(() => { vi.clearAllMocks(); for (const mock of Object.values(mocks)) mock.mockResolvedValue({ data: [] }); });
describe('iCal HTTP boundary', () => {
  it('sends explicit property scope and suppresses raw error logging on every operation', async () => {
    await icalApi.feeds('property-a'); await icalApi.roomTypes('property-a');
    await icalApi.create({ propertyId: 'property-a', roomTypeId: 'room-a', direction: 'export', name: 'Export' });
    await icalApi.update('property-a', 'feed-a', { isActive: false }); await icalApi.remove('property-a', 'feed-a');
    await icalApi.sync('property-a', 'feed-a'); await icalApi.rotate('property-a', 'feed-a'); await icalApi.blocks('property-a', 'feed-a');
    for (const mock of Object.values(mocks)) for (const call of mock.mock.calls) expect(call.at(-1)).toEqual({ params: { propertyId: 'property-a' }, skipErrorToast: true, timeout: 30_000 });
    expect(mocks.post).toHaveBeenCalledWith('/v1/ical/feeds/feed-a/rotate-token', {}, expect.any(Object));
    expect(mocks.delete).toHaveBeenCalledWith('/v1/ical/feeds/feed-a', expect.any(Object));
  });
  it('rejects executable URLs, inline credentials and fragments', () => {
    expect(validCalendarUrl('https://calendar.example.test/feed.ics?token=fixture')).toBe(true);
    for (const url of ['javascript:alert(1)', 'https://user:pass@calendar.example.test/feed.ics', 'https://calendar.example.test/feed.ics#secret', 'not-a-url']) expect(validCalendarUrl(url)).toBe(false);
  });
});
