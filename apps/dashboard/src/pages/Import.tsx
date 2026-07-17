import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Upload,
  Download,
  FileText,
  PlayCircle,
  UploadCloud,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import { useToast } from '../components/ui/Toast';
import { useTranslation } from 'react-i18next';

interface ImportEntity {
  entity: string;
  columns: string[];
  required: string[];
}

interface RowResult {
  index: number;
  success: boolean;
  id?: string;
  error?: string;
}

interface ImportResult {
  entity: string;
  dryRun: boolean;
  total: number;
  created: number;
  failed: number;
  results: RowResult[];
}

function errMsg(e: unknown): string {
  const anyE = e as { response?: { data?: { message?: string } }; message?: string };
  const m = anyE?.response?.data?.message ?? anyE?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Request failed');
}

const UNMAPPED = '';

/** Parse a single CSV line, honoring double-quoted fields with embedded commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Split CSV text into non-empty logical lines (does not handle newlines inside quotes — adequate for migration headers/rows). */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
}

export default function Import() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entity, setEntity] = useState('');
  const [csvText, setCsvText] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRunResult, setDryRunResult] = useState<ImportResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportResult | null>(null);

  const { data: entities = [] } = useQuery<ImportEntity[]>({
    queryKey: ['import-entities', propertyId],
    queryFn: () => api.get('/v1/import/entities').then((r) => r.data),
    enabled: !!propertyId,
  });

  const selectedEntity = useMemo(
    () => entities.find((e) => e.entity === entity) ?? null,
    [entities, entity],
  );

  // Header columns parsed from the pasted/uploaded CSV.
  const sourceColumns = useMemo(() => {
    const lines = splitLines(csvText);
    if (lines.length === 0) return [];
    return parseCsvLine(lines[0]);
  }, [csvText]);

  const dataRowCount = useMemo(() => Math.max(0, splitLines(csvText).length - 1), [csvText]);

  /** Build a default mapping (exact-name match) for the current columns + entity. */
  function buildDefaultMapping(cols: string[], ent: ImportEntity | null): Record<string, string> {
    const map: Record<string, string> = {};
    const canonical = ent?.columns ?? [];
    for (const col of cols) {
      const exact = canonical.find((c) => c.toLowerCase() === col.toLowerCase());
      map[col] = exact ?? UNMAPPED;
    }
    return map;
  }

  function applyCsv(text: string, ent: ImportEntity | null = selectedEntity) {
    setCsvText(text);
    setDryRunResult(null);
    setCommitResult(null);
    const cols = (() => {
      const lines = splitLines(text);
      return lines.length ? parseCsvLine(lines[0]) : [];
    })();
    setMapping(buildDefaultMapping(cols, ent));
  }

  function onEntityChange(value: string) {
    setEntity(value);
    setDryRunResult(null);
    setCommitResult(null);
    const ent = entities.find((e) => e.entity === value) ?? null;
    setMapping(buildDefaultMapping(sourceColumns, ent));
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (!text.trim()) {
        toast('error', 'That file appears to be empty');
        return;
      }
      applyCsv(text);
    };
    reader.onerror = () => toast('error', 'Could not read that file');
    reader.readAsText(file);
    // Allow re-selecting the same file.
    e.target.value = '';
  }

  // Mapping is valid when every required canonical field is mapped from some source column.
  const mappedTargets = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping]);
  const missingRequired = useMemo(
    () => (selectedEntity?.required ?? []).filter((r) => !mappedTargets.has(r)),
    [selectedEntity, mappedTargets],
  );

  const canSubmit =
    !!propertyId &&
    !!selectedEntity &&
    sourceColumns.length > 0 &&
    dataRowCount > 0 &&
    missingRequired.length === 0;

  const runImport = useMutation<ImportResult, unknown, { dryRun: boolean }>({
    mutationFn: ({ dryRun }) =>
      api
        .post(`/v1/import/${entity}`, { csv: csvText, mapping, dryRun })
        .then((r) => r.data),
    onSuccess: (data) => {
      if (data.dryRun) {
        setDryRunResult(data);
        toast(
          data.failed > 0 ? 'info' : 'success',
          `Dry run: ${data.created} of ${data.total} row(s) would import, ${data.failed} error(s)`,
        );
      } else {
        setCommitResult(data);
        toast(
          data.failed > 0 ? 'info' : 'success',
          `Imported ${data.created} of ${data.total} row(s), ${data.failed} error(s)`,
        );
      }
    },
    onError: (e) => toast('error', `Import failed: ${errMsg(e)}`),
  });

  function downloadTemplate() {
    if (!entity) return;
    api
      .get(`/v1/import/templates/${entity}`, { responseType: 'text' })
      .then((r) => {
        const blob = new Blob([r.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${entity}-template.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((e) => toast('error', `Could not download template: ${errMsg(e)}`));
  }

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        Select a property
      </div>
    );
  }

  const lastResult = commitResult ?? dryRunResult;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Upload size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('import.title')}</h1>
      </div>

      <p className="text-sm text-telivity-slate mb-6 max-w-2xl">
        {t('import.description')}
      </p>

      {/* Step 1 — entity */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('import.choose')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem]">
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('import.entity')}</label>
            <select
              value={entity}
              onChange={(e) => onEntityChange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            >
              <option value="">{t('import.selectEntity')}</option>
              {entities.map((e) => (
                <option key={e.entity} value={e.entity}>
                  {e.entity}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={downloadTemplate}
            disabled={!entity}
            className="flex items-center gap-2 border border-telivity-teal text-telivity-teal rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <Download size={15} /> Download CSV template
          </button>
        </div>

        {selectedEntity && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-telivity-slate uppercase mb-1.5">Required columns</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedEntity.required.length === 0 && (
                  <span className="text-xs text-telivity-mid-grey">None</span>
                )}
                {selectedEntity.required.map((c) => (
                  <span key={c} className="bg-telivity-orange/10 text-telivity-orange text-xs rounded px-1.5 py-0.5">
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-telivity-slate uppercase mb-1.5">Optional columns</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedEntity.columns.filter((c) => !selectedEntity.required.includes(c)).length === 0 && (
                  <span className="text-xs text-telivity-mid-grey">None</span>
                )}
                {selectedEntity.columns
                  .filter((c) => !selectedEntity.required.includes(c))
                  .map((c) => (
                    <span key={c} className="bg-telivity-light-grey text-telivity-slate text-xs rounded px-1.5 py-0.5">
                      {c}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step 2 — CSV input */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('import.provideData')}</h2>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-3 py-2 text-sm font-semibold"
          >
            <FileText size={15} /> Upload .csv file
          </button>
          <span className="text-xs text-telivity-mid-grey">{t('import.pasteBelow')}</span>
        </div>
        <textarea
          value={csvText}
          onChange={(e) => applyCsv(e.target.value)}
          rows={6}
          placeholder="name,email,phone&#10;Jane Doe,jane@example.com,+1 555 0100"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-telivity-teal"
        />
        {csvText.trim().length > 0 && (
          <p className="text-xs text-telivity-mid-grey mt-2">
            {sourceColumns.length} column(s), {dataRowCount} data row(s) detected.
          </p>
        )}
      </div>

      {/* Step 3 — mapping */}
      {selectedEntity && sourceColumns.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-3">{t('import.mapColumns')}</h2>
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-4 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('import.sourceColumn')}</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">{t('import.mapsTo')}</th>
              </tr>
            </thead>
            <tbody>
              {sourceColumns.map((col, i) => (
                <tr key={`${col}-${i}`} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-2 text-sm font-medium text-telivity-navy font-mono">{col || <em className="text-telivity-mid-grey">(blank)</em>}</td>
                  <td className="px-4 py-2">
                    <select
                      value={mapping[col] ?? UNMAPPED}
                      onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                      className="w-full max-w-xs border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-telivity-teal"
                    >
                      <option value={UNMAPPED}>— Ignore —</option>
                      {selectedEntity.columns.map((c) => (
                        <option key={c} value={c}>
                          {c}
                          {selectedEntity.required.includes(c) ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {missingRequired.length > 0 && (
            <p className="text-xs text-telivity-orange mt-3">
              Unmapped required field(s): {missingRequired.join(', ')}
            </p>
          )}

          <div className="flex flex-wrap gap-3 mt-5">
            <button
              onClick={() => runImport.mutate({ dryRun: true })}
              disabled={!canSubmit || runImport.isPending}
              className="flex items-center gap-2 border border-telivity-teal text-telivity-teal rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              <PlayCircle size={16} /> {runImport.isPending && runImport.variables?.dryRun ? 'Validating…' : 'Validate (dry run)'}
            </button>
            <button
              onClick={() => runImport.mutate({ dryRun: false })}
              disabled={!canSubmit || !dryRunResult || runImport.isPending}
              className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
              title={!dryRunResult ? 'Run a dry run first' : undefined}
            >
              <UploadCloud size={16} /> {runImport.isPending && runImport.variables?.dryRun === false ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — result report */}
      {lastResult && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-telivity-navy">
              {lastResult.dryRun ? 'Dry run result' : 'Import result'}
            </h2>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                lastResult.dryRun
                  ? 'bg-telivity-deep-blue/10 text-telivity-deep-blue'
                  : 'bg-telivity-dark-teal/10 text-telivity-dark-teal'
              }`}
            >
              {lastResult.dryRun ? 'No data was written' : 'Committed'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-telivity-light-grey rounded-lg p-4 text-center">
              <p className="text-xs text-telivity-mid-grey">Total rows</p>
              <p className="text-2xl font-semibold text-telivity-navy">{lastResult.total}</p>
            </div>
            <div className="bg-telivity-dark-teal/5 rounded-lg p-4 text-center">
              <p className="text-xs text-telivity-mid-grey">{lastResult.dryRun ? 'Would create' : 'Created'}</p>
              <p className="text-2xl font-semibold text-telivity-dark-teal">{lastResult.created}</p>
            </div>
            <div className="bg-telivity-orange/5 rounded-lg p-4 text-center">
              <p className="text-xs text-telivity-mid-grey">Errors</p>
              <p className="text-2xl font-semibold text-telivity-orange">{lastResult.failed}</p>
            </div>
          </div>

          {lastResult.failed > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-100 mb-4">
              <table className="w-full">
                <thead>
                  <tr className="bg-telivity-orange/5 border-b border-gray-100">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Row</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {lastResult.results
                    .filter((r) => !r.success)
                    .map((r) => (
                      <tr key={r.index} className="border-b border-gray-50">
                        <td className="px-4 py-2 text-sm text-telivity-slate whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <XCircle size={14} className="text-telivity-orange" /> {r.index + 1}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-telivity-navy">{r.error ?? 'Unknown error'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {!lastResult.dryRun && lastResult.created > 0 && (
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="w-full">
                <thead>
                  <tr className="bg-telivity-dark-teal/5 border-b border-gray-100">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Row</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-telivity-slate uppercase">Created ID</th>
                  </tr>
                </thead>
                <tbody>
                  {lastResult.results
                    .filter((r) => r.success)
                    .map((r) => (
                      <tr key={r.index} className="border-b border-gray-50">
                        <td className="px-4 py-2 text-sm text-telivity-slate whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 size={14} className="text-telivity-dark-teal" /> {r.index + 1}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-telivity-slate font-mono">{r.id ?? '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
