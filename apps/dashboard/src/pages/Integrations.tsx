import { useEffect, useMemo, useState, Fragment } from 'react';
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

type RedsysEnvironment = 'test' | 'live';

interface RedsysFormState {
  merchantCode: string;
  terminal: string;
  secretKey: string;
  environment: RedsysEnvironment;
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

function stringConfig(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

function hasStoredSecret(config: Record<string, unknown>): boolean {
  return Boolean(
    stringConfig(config, 'secretKeyMasked')
    || stringConfig(config, 'secretKey'),
  );
}

function maskSecretDisplay(config: Record<string, unknown>): string {
  const masked = stringConfig(config, 'secretKeyMasked');
  if (masked) return masked;
  if (stringConfig(config, 'secretKey')) return '••••••';
  return '';
}

function redsysFormFromConfig(config: Record<string, unknown>): RedsysFormState {
  const envRaw = stringConfig(config, 'environment').toLowerCase();
  return {
    merchantCode: stringConfig(config, 'merchantCode'),
    terminal: stringConfig(config, 'terminal') || '001',
    secretKey: '',
    environment: envRaw === 'live' ? 'live' : 'test',
  };
}

function RedsysCredentialsForm({
  row,
  propertyId,
  onSaved,
}: {
  row: CatalogRow;
  propertyId: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [form, setForm] = useState<RedsysFormState>(() => redsysFormFromConfig(row.config ?? {}));

  const cfg = row.config ?? {};
  const configMerchantCode = stringConfig(cfg, 'merchantCode');
  const configTerminal = stringConfig(cfg, 'terminal');
  const configEnvironment = stringConfig(cfg, 'environment');
  const configSecretMasked = stringConfig(cfg, 'secretKeyMasked');
  const configSecretKey = stringConfig(cfg, 'secretKey');

  useEffect(() => {
    setForm(redsysFormFromConfig(cfg));
  }, [
    row.connectionId,
    configMerchantCode,
    configTerminal,
    configEnvironment,
    configSecretMasked,
    configSecretKey,
  ]);

  const secretPlaceholder = hasStoredSecret(cfg)
    ? (maskSecretDisplay(cfg) || '••••••')
    : '';

  const saveMutation = useMutation({
    mutationFn: () => {
      const config: Record<string, string> = {
        merchantCode: form.merchantCode.trim(),
        terminal: form.terminal.trim() || '001',
        environment: form.environment,
      };
      const typedSecret = form.secretKey.trim();
      if (typedSecret) {
        config.secretKey = typedSecret;
      }
      return api.put(
        `/v1/admin/integrations/${row.slug}`,
        { enabled: true, config },
        { params: { propertyId } },
      );
    },
    onSuccess: () => {
      setForm((prev) => ({ ...prev, secretKey: '' }));
      toast('success', t('integrations.saved'));
      onSaved();
    },
    onError: () => {
      toast('error', t('integrations.saveFailed', { defaultValue: 'Failed to save integration' }));
    },
  });

  return (
    <div className="mt-3 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-left">
      <p className="text-xs font-medium text-gray-700">Redsys credentials (FUC / TPV)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-gray-600" htmlFor={`redsys-fuc-${row.slug}`}>
            Merchant code (FUC)
          </label>
          <input
            id={`redsys-fuc-${row.slug}`}
            type="text"
            value={form.merchantCode}
            onChange={(e) => setForm((f) => ({ ...f, merchantCode: e.target.value }))}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600" htmlFor={`redsys-terminal-${row.slug}`}>
            Terminal
          </label>
          <input
            id={`redsys-terminal-${row.slug}`}
            type="text"
            value={form.terminal}
            onChange={(e) => setForm((f) => ({ ...f, terminal: e.target.value }))}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600" htmlFor={`redsys-secret-${row.slug}`}>
            Secret key
          </label>
          <input
            id={`redsys-secret-${row.slug}`}
            type="password"
            value={form.secretKey}
            onChange={(e) => setForm((f) => ({ ...f, secretKey: e.target.value }))}
            placeholder={secretPlaceholder || undefined}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            autoComplete="new-password"
          />
          {secretPlaceholder && !form.secretKey && (
            <p className="mt-1 text-[11px] text-gray-500">Leave blank to keep the existing secret.</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-600" htmlFor={`redsys-env-${row.slug}`}>
            Environment
          </label>
          <select
            id={`redsys-env-${row.slug}`}
            value={form.environment}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                environment: e.target.value === 'live' ? 'live' : 'test',
              }))
            }
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="test">test</option>
            <option value="live">live</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        disabled={saveMutation.isPending || !form.merchantCode.trim()}
        onClick={() => saveMutation.mutate()}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {saveMutation.isPending ? t('common.saving', { defaultValue: 'Saving…' }) : t('common.save', { defaultValue: 'Save' })}
      </button>
    </div>
  );
}

export default function Integrations() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

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
    onSuccess: (_data, row) => {
      queryClient.invalidateQueries({ queryKey: ['property-integrations', propertyId] });
      toast('success', t('integrations.saved'));
      if (row.slug === 'redsys' && !row.enabled) {
        setExpandedSlug('redsys');
      }
    },
  });

  const invalidateIntegrations = () => {
    queryClient.invalidateQueries({ queryKey: ['property-integrations', propertyId] });
  };

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
              {filtered.map((row) => {
                const isRedsys = row.slug === 'redsys';
                const showRedsysForm =
                  isRedsys && (row.enabled || expandedSlug === 'redsys');
                return (
                  <Fragment key={row.slug}>
                    <tr className="hover:bg-gray-50/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{row.name}</div>
                        <div className="text-xs text-gray-500 line-clamp-2">{row.description}</div>
                        {isRedsys && !row.enabled && (
                          <button
                            type="button"
                            className="mt-1 text-xs font-medium text-indigo-600 hover:underline"
                            onClick={() =>
                              setExpandedSlug((s) => (s === 'redsys' ? null : 'redsys'))
                            }
                          >
                            {expandedSlug === 'redsys'
                              ? 'Hide credentials'
                              : 'Configure credentials'}
                          </button>
                        )}
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
                    {showRedsysForm && propertyId && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={5} className="px-4 pb-4">
                          <RedsysCredentialsForm
                            row={{
                              ...row,
                              config: {
                                ...row.config,
                                secretKey: undefined,
                                secretKeyMasked:
                                  stringConfig(row.config ?? {}, 'secretKeyMasked')
                                  || (stringConfig(row.config ?? {}, 'secretKey')
                                    ? '••••••'
                                    : ''),
                              },
                            }}
                            propertyId={propertyId}
                            onSaved={invalidateIntegrations}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
