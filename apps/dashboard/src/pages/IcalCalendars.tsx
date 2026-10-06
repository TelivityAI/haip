import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, Copy, Plus, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { icalApi, validCalendarUrl, type IcalFeed, type IcalFeedInput } from '../lib/ical';

type Draft = IcalFeedInput & { id?: string };
type Confirm = { kind: 'remove' | 'rotate'; feed: IcalFeed };
const control = 'min-h-[44px] rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-telivity-slate hover:bg-telivity-light-grey disabled:opacity-50 disabled:cursor-not-allowed';
const primary = 'min-h-[44px] rounded-lg bg-telivity-teal px-4 py-2 text-sm font-semibold text-white hover:bg-telivity-dark-teal disabled:opacity-50 disabled:cursor-not-allowed';
const input = 'min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-telivity-teal';

export default function IcalCalendars() {
  const { t, i18n } = useTranslation();
  const { propertyId, isPortfolioMode, properties } = useProperty();
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const canManage = hasRole('admin');
  const canSync = hasRole('admin', 'revenue_manager');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [exportResult, setExportResult] = useState<{ name: string; url: string } | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocksFor, setBlocksFor] = useState<IcalFeed | null>(null);
  const scopeRef = useRef(propertyId);
  scopeRef.current = propertyId;
  const formRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const scopes = isPortfolioMode ? properties.map(p => p.id) : propertyId ? [propertyId] : [];
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['ical-feeds', scopes], enabled: scopes.length > 0 && canSync, retry: false,
    queryFn: async () => {
      const result = await Promise.all(scopes.map(async id => {
        const [feeds, roomTypes] = await Promise.all([icalApi.feeds(id), icalApi.roomTypes(id)]);
        if (!Array.isArray(feeds) || !Array.isArray(roomTypes) || feeds.some(feed => feed.propertyId !== id) || roomTypes.some(type => type.propertyId !== id)) throw new Error('Invalid scoped calendar response');
        return { feeds, roomTypes };
      }));
      return { feeds: result.flatMap(entry => entry.feeds), roomTypes: result.flatMap(entry => entry.roomTypes) };
    },
  });
  const blocked = useQuery({
    queryKey: ['ical-blocks', blocksFor?.propertyId, blocksFor?.id], enabled: !!blocksFor, retry: false,
    queryFn: () => icalApi.blocks(blocksFor!.propertyId, blocksFor!.id),
  });
  useEffect(() => { setDraft(null); setConfirm(null); setExportResult(null); setNotice(null); setBlocksFor(null); }, [propertyId]);
  useEffect(() => {
    const dialog = confirmRef.current;
    if (confirm && dialog && !dialog.open) dialog.showModal();
    if (!confirm && dialog?.open) dialog.close();
  }, [confirm]);
  useEffect(() => {
    if (draft) { formRef.current?.scrollIntoView({ block: 'nearest' }); formRef.current?.querySelector<HTMLInputElement>('#ical-name')?.focus(); }
  }, [draft?.id, draft !== null]);

  async function run(action: () => Promise<void>, success: string) {
    if (busy) return;
    const scope = propertyId;
    setBusy(true); setNotice(null);
    try { await action(); if (scopeRef.current === scope) setNotice({ error: false, text: success }); }
    catch { if (scopeRef.current === scope) setNotice({ error: true, text: t('ical.requestFailed') }); }
    finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ['ical-feeds'] });
      await queryClient.invalidateQueries({ queryKey: ['ical-blocks'] });
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const current = draft;
    const scope = propertyId;
    if (!current.name.trim() || !current.propertyId || !current.roomTypeId || current.direction === 'import' && !validCalendarUrl(current.sourceUrl?.trim() ?? '')) {
      setNotice({ error: true, text: t('ical.invalidForm') }); return;
    }
    await run(async () => {
      if (current.id) await icalApi.update(current.propertyId, current.id, { name: current.name.trim(), ...(current.direction === 'import' ? { sourceUrl: current.sourceUrl!.trim() } : {}) });
      else {
        const result = await icalApi.create({ propertyId: current.propertyId, roomTypeId: current.roomTypeId, direction: current.direction, name: current.name.trim(), ...(current.direction === 'import' ? { sourceUrl: current.sourceUrl!.trim() } : {}) });
        if (result.exportUrl && scopeRef.current === scope && validCalendarUrl(result.exportUrl)) setExportResult({ name: result.feed.name, url: result.exportUrl });
      }
      if (scopeRef.current === scope) setDraft(null);
    }, t('ical.saved'));
  }
  const roomTypes = data?.roomTypes ?? [];
  const feeds = data?.feeds ?? [];
  const back = `/channels${propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : ''}`;
  const selectedRoomTypes = roomTypes.filter(type => type.propertyId === draft?.propertyId);

  return <div>
    <Link to={back} className="mb-5 inline-flex min-h-[44px] items-center gap-2 text-sm text-telivity-slate"><ChevronLeft size={18} aria-hidden="true" />{t('channels.title')}</Link>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="flex items-center gap-3 text-2xl font-semibold text-telivity-navy"><CalendarDays size={24} aria-hidden="true" />{t('ical.title')}</h1><p className="mt-2 max-w-2xl text-sm text-telivity-slate">{t('ical.description')}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy || isFetching || !canSync} onClick={() => void refetch()}><RefreshCw size={16} className="mr-2 inline" aria-hidden="true" />{t('ical.refresh')}</button>{canManage && <button type="button" className={primary} disabled={busy || !data} onClick={() => { setDraft({ propertyId: isPortfolioMode ? '' : propertyId ?? '', roomTypeId: '', direction: 'import', name: '', sourceUrl: '' }); setNotice(null); }}><Plus size={16} className="mr-2 inline" aria-hidden="true" />{t('ical.add')}</button>}</div>
    </div>
    {!canSync && <p role="alert" className="mb-5 text-sm text-telivity-slate">{t('ical.noPermission')}</p>}
    {notice && <p role={notice.error ? 'alert' : 'status'} className={`mb-5 rounded-lg border border-gray-200 bg-white p-4 text-sm ${notice.error ? 'text-red-700' : 'text-telivity-dark-teal'}`}>{notice.text}</p>}
    {exportResult && <section aria-labelledby="ical-export-heading" className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
      <h2 id="ical-export-heading" className="font-semibold text-telivity-navy">{t('ical.exportReady', { name: exportResult.name })}</h2><p id="ical-export-help" className="my-3 text-sm text-telivity-slate">{t('ical.exportHelp')}</p>
      <label htmlFor="ical-export-url" className="mb-2 block text-sm font-medium">{t('ical.exportUrl')}</label><input id="ical-export-url" className={input} readOnly value={exportResult.url} aria-describedby="ical-export-help" onFocus={event => event.currentTarget.select()} />
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={control} onClick={() => {
        if (!navigator.clipboard) { setNotice({ error: true, text: t('ical.copyFailed') }); return; }
        void navigator.clipboard.writeText(exportResult.url).then(() => setNotice({ error: false, text: t('ical.copied') })).catch(() => setNotice({ error: true, text: t('ical.copyFailed') }));
      }}><Copy size={16} aria-hidden="true" className="mr-2 inline" />{t('ical.copy')}</button><button type="button" className={control} onClick={() => setExportResult(null)}>{t('ical.dismissUrl')}</button></div>
    </section>}
    {draft && <div ref={formRef} className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-telivity-navy">{draft.id ? t('ical.edit') : t('ical.add')}</h2><button type="button" className={control} aria-label={t('common.close')} disabled={busy} onClick={() => setDraft(null)}><X size={18} aria-hidden="true" /></button></div>
      <form onSubmit={event => void submit(event)} className="grid gap-5 sm:grid-cols-2" aria-busy={busy}>
        <div><label htmlFor="ical-name" className="mb-2 block text-sm font-medium">{t('ical.name')}</label><input id="ical-name" className={input} value={draft.name} required maxLength={120} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
        <div><label htmlFor="ical-direction" className="mb-2 block text-sm font-medium">{t('ical.direction')}</label><select id="ical-direction" className={input} value={draft.direction} disabled={busy || !!draft.id} onChange={event => setDraft({ ...draft, direction: event.target.value as Draft['direction'] })}><option value="import">{t('ical.import')}</option><option value="export">{t('ical.export')}</option></select></div>
        <div><label htmlFor="ical-property" className="mb-2 block text-sm font-medium">{t('ical.property')}</label><select id="ical-property" className={input} required value={draft.propertyId} disabled={busy || !!draft.id || !isPortfolioMode} onChange={event => setDraft({ ...draft, propertyId: event.target.value, roomTypeId: '' })}><option value="">{t('ical.chooseProperty')}</option>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></div>
        <div><label htmlFor="ical-room-type" className="mb-2 block text-sm font-medium">{t('ical.roomType')}</label><select id="ical-room-type" className={input} required value={draft.roomTypeId} disabled={busy || !!draft.id} onChange={event => setDraft({ ...draft, roomTypeId: event.target.value })}><option value="">{t('ical.chooseRoomType')}</option>{selectedRoomTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div>
        {draft.direction === 'import' && <div className="sm:col-span-2"><label htmlFor="ical-source" className="mb-2 block text-sm font-medium">{t('ical.sourceUrl')}</label><input id="ical-source" type="url" className={input} value={draft.sourceUrl ?? ''} required disabled={busy} aria-describedby="ical-source-help" onChange={event => setDraft({ ...draft, sourceUrl: event.target.value })} /><p id="ical-source-help" className="mt-2 text-sm text-telivity-slate">{t('ical.sourceHelp')}</p></div>}
        <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" className={primary} disabled={busy}>{busy ? t('ical.saving') : t('ical.save')}</button><button type="button" className={control} disabled={busy} onClick={() => setDraft(null)}>{t('common.cancel')}</button></div>
      </form>
    </div>}
    {canSync && scopes.length > 0 && isPending && <p role="status" className="py-8 text-sm text-telivity-slate">{t('ical.loading')}</p>}
    {isError && <p role="alert" className="py-5 text-sm text-red-700">{t('ical.loadFailed')}</p>}
    {data && feeds.length === 0 && <div className="rounded-xl border border-gray-200 bg-white px-6 py-10"><h2 className="font-semibold text-telivity-navy">{t('ical.empty')}</h2><p className="mt-2 text-sm text-telivity-slate">{canManage ? t('ical.emptyHelp') : t('ical.emptyReadOnly')}</p></div>}
    <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
      {feeds.map(feed => <section key={feed.id} aria-label={feed.name} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 className="break-words font-semibold text-telivity-navy">{feed.name}</h2><p className="mt-1 text-sm text-telivity-slate">{properties.find(property => property.id === feed.propertyId)?.name} · {roomTypes.find(type => type.id === feed.roomTypeId)?.name} · {feed.direction === 'import' ? t('ical.import') : t('ical.export')}</p><p className="mt-2 text-sm text-telivity-slate">{feed.isActive ? t('ical.active') : t('ical.inactive')}{feed.direction === 'import' && <> · {feed.lastSyncAt ? t('ical.lastSync', { time: new Date(feed.lastSyncAt).toLocaleString(i18n.resolvedLanguage) }) : t('ical.neverSynced')}{feed.lastSyncStatus === 'failed' && <span className="ml-2 text-red-700">{t('ical.syncFailed')}</span>}</>}</p></div>
          <div className="flex flex-wrap gap-2">
            {feed.direction === 'import' && <><button type="button" className={control} disabled={busy || !feed.isActive} onClick={() => void run(() => icalApi.sync(feed.propertyId, feed.id), t('ical.synced'))}>{t('ical.sync')}</button><button type="button" className={control} disabled={busy} onClick={() => setBlocksFor(blocksFor?.id === feed.id ? null : feed)} aria-expanded={blocksFor?.id === feed.id} aria-controls={`ical-blocks-${feed.id}`}>{t('ical.viewDates')}</button></>}
            {canManage && <><button type="button" className={control} disabled={busy} onClick={() => setDraft({ id: feed.id, propertyId: feed.propertyId, roomTypeId: feed.roomTypeId, direction: feed.direction, name: feed.name, ...(feed.sourceUrl ? { sourceUrl: feed.sourceUrl } : {}) })}>{t('ical.edit')}</button><button type="button" className={control} disabled={busy} onClick={() => void run(async () => { await icalApi.update(feed.propertyId, feed.id, { isActive: !feed.isActive }); }, t('ical.saved'))}>{feed.isActive ? t('ical.deactivate') : t('ical.activate')}</button>{feed.direction === 'export' && <button type="button" className={control} disabled={busy} onClick={() => setConfirm({ kind: 'rotate', feed })}>{t('ical.regenerate')}</button>}<button type="button" className={control} disabled={busy} onClick={() => setConfirm({ kind: 'remove', feed })}>{t('ical.remove')}</button></>}
          </div>
        </div>
        {blocksFor?.id === feed.id && <div id={`ical-blocks-${feed.id}`} className="mt-4 border-t border-gray-100 pt-4">{blocked.isPending ? <p role="status">{t('ical.loadingDates')}</p> : blocked.isError ? <p role="alert">{t('ical.loadFailed')}</p> : <><h3 className="mb-3 text-sm font-semibold">{t('ical.blockedDates')}</h3>{blocked.data?.length ? <ul className="space-y-2 text-sm text-telivity-slate">{blocked.data.map((block, index) => <li key={`${block.externalUid}-${index}`}>{block.startDate} → {block.endDate} <span>{t('ical.checkoutExclusive')}</span></li>)}</ul> : <p className="text-sm text-telivity-slate">{t('ical.noBlocks')}</p>}</>}</div>}
      </section>)}
    </div>
    <p className="mt-5 max-w-3xl text-sm text-telivity-slate">{t('ical.syncHelp')}</p>
    <dialog ref={confirmRef} onCancel={event => { if (busy) event.preventDefault(); else setConfirm(null); }} onClose={() => setConfirm(null)} className="w-full max-w-md rounded-xl border-0 bg-white p-6 shadow-xl backdrop:bg-black/40" aria-labelledby="ical-confirm-title" aria-describedby="ical-confirm-description">
      <h2 id="ical-confirm-title" className="text-lg font-semibold text-telivity-navy">{confirm?.kind === 'rotate' ? t('ical.regenerate') : t('ical.remove')}</h2><p id="ical-confirm-description" className="my-4 text-sm text-telivity-slate">{confirm?.kind === 'rotate' ? t('ical.rotateWarning') : t('ical.removeWarning')}</p>
      {notice?.error && <p role="alert" className="mb-4 text-sm text-red-700">{notice.text}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={control} disabled={busy} onClick={() => setConfirm(null)}>{t('common.cancel')}</button><button type="button" className={primary} disabled={busy} onClick={() => {
        if (!confirm) return;
        const current = confirm; const scope = propertyId;
        void run(async () => {
          if (current.kind === 'remove') { await icalApi.remove(current.feed.propertyId, current.feed.id); if (scopeRef.current === scope) { setBlocksFor(null); setExportResult(null); } }
          else { const result = await icalApi.rotate(current.feed.propertyId, current.feed.id); if (scopeRef.current === scope && result.exportUrl && validCalendarUrl(result.exportUrl)) setExportResult({ name: result.feed.name, url: result.exportUrl }); }
          if (scopeRef.current === scope) setConfirm(null);
        }, current.kind === 'rotate' ? t('ical.regenerated') : t('ical.removed'));
      }}>{busy ? t('ical.saving') : confirm?.kind === 'rotate' ? t('ical.regenerate') : t('ical.remove')}</button></div>
    </dialog>
  </div>;
}
