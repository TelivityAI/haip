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

/** Calendar URLs are credentials. Handle failures locally rather than logging
 * provider messages or request config through the dashboard interceptor. */
export const icalApi = {
  feeds: (propertyId: string) => api.get<IcalFeed[]>('/v1/ical/feeds', config(propertyId)).then(r => r.data),
  roomTypes: (propertyId: string) => api.get<IcalRoomType[]>('/v1/rooms/types', config(propertyId)).then(r => r.data),
  create: (input: IcalFeedInput) => api.post<IcalFeedResult>('/v1/ical/feeds', input, config(input.propertyId)).then(r => r.data),
  update: (propertyId: string, id: string, patch: { name?: string; sourceUrl?: string; isActive?: boolean }) => api.patch<IcalFeed>(`/v1/ical/feeds/${id}`, patch, config(propertyId)).then(r => r.data),
  remove: (propertyId: string, id: string) => api.delete(`/v1/ical/feeds/${id}`, config(propertyId)).then(() => undefined),
  sync: (propertyId: string, id: string) => api.post(`/v1/ical/feeds/${id}/sync`, {}, config(propertyId)).then(() => undefined),
  rotate: (propertyId: string, id: string) => api.post<IcalFeedResult>(`/v1/ical/feeds/${id}/rotate-token`, {}, config(propertyId)).then(r => r.data),
  blocks: (propertyId: string, id: string) => api.get<IcalBlock[]>(`/v1/ical/feeds/${id}/blocks`, config(propertyId)).then(r => r.data),
};
export function validCalendarUrl(value: string): boolean {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
