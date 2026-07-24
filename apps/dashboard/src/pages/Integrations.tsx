import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../components/ui/Toast';
import StatusBadge from '../components/ui/StatusBadge';

interface CatalogRow {
  slug: string;
  category: string;
  name: string;
  status: string;
  description: string;
  docsPath?: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  connectionId: string | null;
}

function statusColor(status: string) {
  switch (status) {
    case 'shipped':
      return 'success';
    case 'recipe':
    case 'adapter':
      return 'info';
    case 'planned':
      return 'default';
    default:
      return 'default';
  }
}

function errMsg(e: unknown): string {
  const anyE = e as { response?: { data?: { message?: string } }; message?: string };
  const m = anyE?.response?.data?.message ?? anyE?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

export default function Integrations() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['property-integrations', propertyId],
    queryFn: () =>
      api.get<CatalogRow[]>('/v1/admin/integrations', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const rows: CatalogRow[] = data ?? [];

  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => r.category));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = categoryFilter
    ? rows.filter((r) => r.category === categoryFilter)
    : rows;

  const toggleMutation = useMutation({
    mutationFn: (row: CatalogRow) =>
      api.put(
        `/v1/admin/integrations/${row.slug}`,
        { enabled: !row.enabled, config: row.config ?? {} },
        { params: { propertyId } },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-integrations', propertyId] });
      toast('success', t('integrations.saved'));
    },
    onError: (e) => toast('error', errMsg(e)),
  });

  if (!propertyId) {
    return (
      <div className="p-6 text-sm text-gray-500">{t('integrations.selectProperty')}</div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Plug className="h-7 w-7 text-indigo-600" />
            {t('integrations.title')}
          </h1>
          <p className="text-sm text-gray-600 mt-1">{t('integrations.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          {t('integrations.refresh')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600" htmlFor="integration-category">
          {t('integrations.category')}
        </label>
        <select
          id="integration-category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">{t('integrations.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">{t('integrations.loading')}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">{t('integrations.name')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">{t('integrations.category')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">{t('integrations.catalogStatus')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">{t('integrations.propertyStatus')}</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">{t('integrations.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((row) => (
                <tr key={row.slug} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{row.name}</div>
                    <div className="text-xs text-gray-500 line-clamp-2">{row.description}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.category}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={statusColor(row.status)} label={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={row.enabled ? 'success' : 'default'}
                      label={row.enabled ? t('integrations.enabled') : t('integrations.disabled')}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate(row)}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {row.enabled ? t('integrations.disable') : t('integrations.enable')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-6 text-sm text-gray-500">{t('integrations.empty')}</p>
          )}
        </div>
      )}
    </div>
  );
}
