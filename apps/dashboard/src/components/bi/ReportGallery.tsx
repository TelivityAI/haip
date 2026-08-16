import type { LucideIcon } from 'lucide-react';
import { Star } from 'lucide-react';

export interface ReportGalleryItem {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  category: string;
  favorite?: boolean;
  portfolioOk?: boolean;
}

interface ReportGalleryProps {
  items: ReportGalleryItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  favoriteLabel: string;
  unfavoriteLabel: string;
}

export default function ReportGallery({
  items,
  activeId,
  onSelect,
  onToggleFavorite,
  favoriteLabel,
  unfavoriteLabel,
}: ReportGalleryProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeId === item.id;
        return (
          <div
            key={item.id}
            className={`group relative rounded-2xl border p-4 transition-all bi-enter ${
              active
                ? 'border-telivity-teal bg-telivity-teal/5 shadow-md ring-1 ring-telivity-teal/30'
                : 'border-black/[0.04] bg-white hover:border-telivity-teal/40 hover:shadow-sm'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              className="w-full text-left"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2.5 rounded-xl ${
                    active ? 'bg-telivity-teal text-white' : 'bg-telivity-navy/5 text-telivity-navy'
                  }`}
                >
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1 pr-8">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-telivity-mid-grey">
                    {item.category}
                  </p>
                  <p className="text-sm font-semibold text-telivity-navy mt-0.5">{item.title}</p>
                  <p className="text-xs text-telivity-slate mt-1 line-clamp-2">{item.description}</p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(item.id);
              }}
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-telivity-light-grey"
              title={item.favorite ? unfavoriteLabel : favoriteLabel}
              aria-label={item.favorite ? unfavoriteLabel : favoriteLabel}
            >
              <Star
                size={14}
                className={
                  item.favorite
                    ? 'fill-telivity-teal text-telivity-teal'
                    : 'text-telivity-mid-grey group-hover:text-telivity-teal'
                }
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
