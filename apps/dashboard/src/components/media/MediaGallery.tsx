import { useState, useRef } from 'react';
import { Star, Trash2, ArrowLeft, ArrowRight, ImagePlus, Upload, Link as LinkIcon } from 'lucide-react';
import {
  useMediaList,
  useMediaConfig,
  useMediaMutations,
  type MediaOwnerType,
  type MediaItem,
} from '../../hooks/useMedia';

interface Props {
  propertyId: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  /** Show add/edit controls (admin). Defaults to true. */
  canManage?: boolean;
}

/**
 * Reusable image gallery for a property / room type / room. Lists media ordered
 * by sortOrder with primary badge, supports add-by-URL (always), file upload
 * (only when object storage is configured), set-primary, delete, and reorder.
 */
export default function MediaGallery({ propertyId, ownerType, ownerId, canManage = true }: Props) {
  const { data: items = [], isLoading } = useMediaList(propertyId, ownerType, ownerId);
  const { data: config } = useMediaConfig();
  const { addByUrl, upload, remove, setPrimary, reorder } = useMediaMutations(propertyId, ownerType, ownerId);

  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    reorder.mutate(next.map((m) => m.id));
  };

  const submitUrl = () => {
    if (!url.trim()) return;
    addByUrl.mutate(
      { url: url.trim(), caption: caption.trim() || undefined },
      { onSuccess: () => { setUrl(''); setCaption(''); } },
    );
  };

  return (
    <div>
      {isLoading ? (
        <p className="text-sm text-telivity-mid-grey">Loading images…</p>
      ) : items.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-telivity-mid-grey">
          <ImagePlus size={28} className="mx-auto mb-2 opacity-60" />
          No images yet
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((m: MediaItem, i: number) => (
            <div key={m.id} className="group relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
              <img src={m.url} alt={m.altText ?? m.caption ?? ''} className="w-full h-32 object-cover" loading="lazy" />
              {m.isPrimary && (
                <span className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-telivity-teal text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                  <Star size={10} fill="currentColor" /> Primary
                </span>
              )}
              {m.caption && (
                <p className="absolute bottom-0 inset-x-0 bg-black/45 text-white text-[11px] px-2 py-1 truncate">{m.caption}</p>
              )}
              {canManage && (
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!m.isPrimary && (
                    <button title="Set as primary" onClick={() => setPrimary.mutate(m.id)} className="p-1 rounded bg-white/90 hover:bg-white text-telivity-slate">
                      <Star size={13} />
                    </button>
                  )}
                  <button title="Delete" onClick={() => remove.mutate(m.id)} className="p-1 rounded bg-white/90 hover:bg-white text-red-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
              {canManage && items.length > 1 && (
                <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button title="Move left" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 rounded bg-white/90 hover:bg-white text-telivity-slate disabled:opacity-30">
                    <ArrowLeft size={13} />
                  </button>
                  <button title="Move right" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="p-1 rounded bg-white/90 hover:bg-white text-telivity-slate disabled:opacity-30">
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="mt-4 border-t border-gray-100 pt-4 space-y-2">
          <div className="flex items-center gap-2">
            <LinkIcon size={14} className="text-telivity-mid-grey shrink-0" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste an image URL"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            />
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption (optional)"
              className="w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal"
            />
            <button
              onClick={submitUrl}
              disabled={!url.trim() || addByUrl.isPending}
              className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 shrink-0"
            >
              Add
            </button>
          </div>

          {config?.uploadEnabled && (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
                className="flex items-center gap-2 text-sm text-telivity-slate hover:text-telivity-teal disabled:opacity-50"
              >
                <Upload size={14} /> {upload.isPending ? 'Uploading…' : 'Upload a file'}
              </button>
            </div>
          )}
          {addByUrl.isError && <p className="text-xs text-red-500">Could not add image. Check the URL.</p>}
        </div>
      )}
    </div>
  );
}
