import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export type MediaOwnerType = 'property' | 'room_type' | 'room';
export type MediaCategory =
  | 'hero'
  | 'exterior'
  | 'room'
  | 'amenity'
  | 'dining'
  | 'other';

export interface MediaItem {
  id: string;
  propertyId: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  url: string;
  storageKey: string | null;
  category: MediaCategory;
  caption: string | null;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

/** Whether the upload pipeline is available (object storage configured). */
export function useMediaConfig() {
  return useQuery({
    queryKey: ['media', 'config'],
    queryFn: () =>
      api.get('/v1/media/config').then((r) => r.data as { uploadEnabled: boolean }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMediaList(
  propertyId: string | null,
  ownerType: MediaOwnerType,
  ownerId: string | null,
) {
  return useQuery({
    queryKey: ['media', ownerType, ownerId],
    queryFn: () =>
      api
        .get('/v1/media', { params: { propertyId, ownerType, ownerId } })
        .then((r) => r.data as MediaItem[]),
    enabled: !!propertyId && !!ownerId,
  });
}

export function useMediaMutations(
  propertyId: string,
  ownerType: MediaOwnerType,
  ownerId: string,
) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['media', ownerType, ownerId] });

  const addByUrl = useMutation({
    mutationFn: (body: { url: string; category?: MediaCategory; caption?: string }) =>
      api.post('/v1/media', { propertyId, ownerType, ownerId, ...body }),
    onSuccess: invalidate,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('propertyId', propertyId);
      fd.append('ownerType', ownerType);
      fd.append('ownerId', ownerId);
      // Let the browser set the multipart boundary.
      return api.post('/v1/media/upload', fd, {
        headers: { 'Content-Type': undefined as unknown as string },
      });
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/media/${id}`, { params: { propertyId } }),
    onSuccess: invalidate,
  });

  const setPrimary = useMutation({
    mutationFn: (id: string) =>
      api.post(`/v1/media/${id}/primary`, {}, { params: { propertyId } }),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) =>
      api.post('/v1/media/reorder', { propertyId, ownerType, ownerId, orderedIds }),
    onSuccess: invalidate,
  });

  return { addByUrl, upload, remove, setPrimary, reorder };
}
