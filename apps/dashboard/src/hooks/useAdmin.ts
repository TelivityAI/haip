import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface AdminUserRole {
  id: string;
  key: string;
  name: string;
}
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'disabled' | 'invited';
  keycloakSub: string | null;
  roles: AdminUserRole[];
}
export interface AdminRole {
  id: string;
  propertyId: string | null;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}
export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  navKey?: string;
}

/** Current user's effective permissions (drives nav/feature visibility). */
export function useMyPermissions(propertyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'me', 'permissions', propertyId],
    queryFn: () =>
      api
        .get('/v1/admin/me/permissions', { params: { propertyId } })
        .then((r) => r.data as { permissions: string[]; navKeys: string[] }),
    enabled: enabled && !!propertyId,
  });
}

export function usePermissionCatalog(propertyId: string | null) {
  return useQuery({
    queryKey: ['admin', 'permissions-catalog'],
    queryFn: () =>
      api
        .get('/v1/admin/permissions', { params: { propertyId } })
        .then((r) => r.data as PermissionDef[]),
    enabled: !!propertyId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUsers(propertyId: string | null) {
  return useQuery({
    queryKey: ['admin', 'users', propertyId],
    queryFn: () =>
      api.get('/v1/admin/users', { params: { propertyId } }).then((r) => r.data as AdminUser[]),
    enabled: !!propertyId,
  });
}

export function useRoles(propertyId: string | null) {
  return useQuery({
    queryKey: ['admin', 'roles', propertyId],
    queryFn: () =>
      api.get('/v1/admin/roles', { params: { propertyId } }).then((r) => r.data as AdminRole[]),
    enabled: !!propertyId,
  });
}

export function useUserMutations(propertyId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'users', propertyId] });

  return {
    create: useMutation({
      mutationFn: (body: { email: string; name: string; roleIds?: string[] }) =>
        api.post('/v1/admin/users', { propertyId, ...body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name?: string; status?: string }) =>
        api.patch(`/v1/admin/users/${id}`, body, { params: { propertyId } }),
      onSuccess: invalidate,
    }),
    disable: useMutation({
      mutationFn: (id: string) => api.delete(`/v1/admin/users/${id}`, { params: { propertyId } }),
      onSuccess: invalidate,
    }),
    assignRoles: useMutation({
      mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) =>
        api.put(`/v1/admin/users/${id}/roles`, { roleIds }, { params: { propertyId } }),
      onSuccess: invalidate,
    }),
  };
}

export function useRoleMutations(propertyId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'roles', propertyId] });

  return {
    create: useMutation({
      mutationFn: (body: { key: string; name: string; description?: string }) =>
        api.post('/v1/admin/roles', { propertyId, ...body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string }) =>
        api.patch(`/v1/admin/roles/${id}`, body, { params: { propertyId } }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`/v1/admin/roles/${id}`, { params: { propertyId } }),
      onSuccess: invalidate,
    }),
    setPermissions: useMutation({
      mutationFn: ({ id, permissionKeys }: { id: string; permissionKeys: string[] }) =>
        api.put(`/v1/admin/roles/${id}/permissions`, { permissionKeys }, { params: { propertyId } }),
      onSuccess: invalidate,
    }),
  };
}
