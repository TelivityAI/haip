import { api } from './api';

export interface IcalFeed {
  id: string; propertyId: string; roomTypeId: string; name: string;
  direction: 'import' | 'export'; sourceUrl: string | null; isActive: boolean;
  lastSyncAt: string | null; lastSyncStatus: string | null;
}
export interface IcalRoomType { id: string; propertyId: string; name: string }
export interface IcalBlock { externalUid: string; startDate: string; endDate: string }
export interface IcalFeedInput {
  propertyId: string; roomTypeId: string; direction: 'import' | 'export'; name: string; sourceUrl?: string;
}
export interface IcalFeedResult { feed: IcalFeed; exportUrl?: string }
const config = (propertyId: string) => ({ params: { propertyId }, skipErrorToast: true, timeout: 30_000 });
const feedPath = (id: string) => `/v1/ical/feeds/${encodeURIComponent(id)}`;

function publicFeed(feed: IcalFeed): IcalFeed {
  return {
    id: feed.id,
    propertyId: feed.propertyId,
    roomTypeId: feed.roomTypeId,
    name: feed.name,
    direction: feed.direction,
    sourceUrl: feed.sourceUrl,
    isActive: feed.isActive,
    lastSyncAt: feed.lastSyncAt,
    lastSyncStatus: feed.lastSyncStatus,
  };
}

function publicFeeds(rows: IcalFeed[]): IcalFeed[] {
  return Array.isArray(rows) ? rows.map((row) => publicFeed(row)) : rows;
}

function publicResult(result: IcalFeedResult): IcalFeedResult {
  if (!result || Array.isArray(result) || !result.feed) return result;
  return { ...result, feed: publicFeed(result.feed) };
}

/** Calendar URLs are credentials. Handle failures locally rather than logging
 * provider messages or request config through the dashboard interceptor. */
export const icalApi = {
  feeds: (propertyId: string) => api.get<IcalFeed[]>('/v1/ical/feeds', config(propertyId)).then(r => publicFeeds(r.data)),
  roomTypes: (propertyId: string) => api.get<IcalRoomType[]>('/v1/rooms/types', config(propertyId)).then(r => r.data),
  create: (input: IcalFeedInput) => api.post<IcalFeedResult>('/v1/ical/feeds', input, config(input.propertyId)).then(r => publicResult(r.data)),
  update: (propertyId: string, id: string, patch: { name?: string; sourceUrl?: string; isActive?: boolean }) => api.patch<IcalFeed>(feedPath(id), patch, config(propertyId)).then(r => (r.data && !Array.isArray(r.data) ? publicFeed(r.data) : r.data)),
  remove: (propertyId: string, id: string) => api.delete(feedPath(id), config(propertyId)).then(() => undefined),
  sync: (propertyId: string, id: string) => api.post(`${feedPath(id)}/sync`, {}, config(propertyId)).then(() => undefined),
  rotate: (propertyId: string, id: string) => api.post<IcalFeedResult>(`${feedPath(id)}/rotate-token`, {}, config(propertyId)).then(r => publicResult(r.data)),
  blocks: (propertyId: string, id: string) => api.get<IcalBlock[]>(`${feedPath(id)}/blocks`, config(propertyId)).then(r => r.data),
};
export function validCalendarUrl(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
