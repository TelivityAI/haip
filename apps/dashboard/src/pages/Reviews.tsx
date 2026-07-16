import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Star, Plus, Check, Edit3 } from 'lucide-react';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

interface Review {
  id: string;
  source: string;
  guestName: string;
  rating: number;
  reviewText: string;
  stayDate?: string;
  responseStatus: string;
  responseText?: string;
  createdAt: string;
}

const SOURCE_LABEL_KEYS: Record<string, string> = {
  google: 'google',
  tripadvisor: 'tripadvisor',
  booking_com: 'bookingCom',
  expedia: 'expedia',
  other: 'other',
};

function sourceLabel(t: TFunction, source: string) {
  const key = SOURCE_LABEL_KEYS[source];
  return key ? t(`reviews.sources.${key}`) : source;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  drafted: 'info',
  approved: 'success',
  posted: 'success',
};

function reviewStatusLabel(t: TFunction, status: string) {
  return t(`reviews.statuses.${status}`, { defaultValue: status });
}

function RatingStars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          className={i <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
        />
      ))}
    </div>
  );
}

export default function Reviews() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingResponse, setEditingResponse] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Form state
  const [form, setForm] = useState({
    source: 'google',
    guestName: '',
    rating: 5,
    reviewText: '',
    stayDate: '',
  });

  const { data: reviews } = useQuery({
    queryKey: ['reviews', propertyId, filterStatus],
    queryFn: () =>
      api
        .get(`/v1/agents/${propertyId}/reviews`, {
          params: filterStatus ? { status: filterStatus } : {},
        })
        .then((r) => r.data?.data ?? r.data ?? []),
    enabled: !!propertyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post(`/v1/agents/${propertyId}/reviews`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      setShowAdd(false);
      setForm({ source: 'google', guestName: '', rating: 5, reviewText: '', stayDate: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.patch(`/v1/agents/${propertyId}/reviews/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  });

  const reviewList: Review[] = Array.isArray(reviews) ? reviews : [];

  // Stats
  const avgRating =
    reviewList.length > 0
      ? (reviewList.reduce((s, r) => s + r.rating, 0) / reviewList.length).toFixed(1)
      : '—';
  const responseRate =
    reviewList.length > 0
      ? Math.round(
          (reviewList.filter((r) => r.responseStatus === 'posted' || r.responseStatus === 'approved').length /
            reviewList.length) *
            100,
        )
      : 0;

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('reviews.selectProperty')}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MessageSquare size={24} className="text-telivity-teal" />
          <h1 className="text-2xl font-semibold text-telivity-navy">{t('reviews.title')}</h1>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal"
        >
          <Plus size={16} />
          {t('reviews.add')}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-telivity-mid-grey uppercase mb-1">{t('reviews.avgRating')}</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-telivity-navy">{avgRating}</p>
            <Star size={18} className="text-yellow-400 fill-yellow-400" />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-telivity-mid-grey uppercase mb-1">{t('reviews.totalReviews')}</p>
          <p className="text-2xl font-bold text-telivity-navy">{reviewList.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-telivity-mid-grey uppercase mb-1">{t('reviews.responseRate')}</p>
          <p className="text-2xl font-bold text-telivity-navy">{responseRate}%</p>
        </div>
      </div>

      {/* Add Review Form */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h2 className="text-sm font-semibold text-telivity-navy mb-4">{t('reviews.add')}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reviews.source')}</label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                {Object.keys(SOURCE_LABEL_KEYS).map((source) => (
                  <option key={source} value={source}>{sourceLabel(t, source)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reviews.guestName')}</label>
              <input
                value={form.guestName}
                onChange={(e) => setForm({ ...form, guestName: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reviews.rating')}</label>
              <div className="flex gap-1 mt-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button
                    key={i}
                    onClick={() => setForm({ ...form, rating: i })}
                    className="p-0.5"
                  >
                    <Star
                      size={20}
                      className={i <= form.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}
                    />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reviews.stayDate')}</label>
              <input
                type="date"
                value={form.stayDate}
                onChange={(e) => setForm({ ...form, stayDate: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('reviews.reviewText')}</label>
              <textarea
                value={form.reviewText}
                onChange={(e) => setForm({ ...form, reviewText: e.target.value })}
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder={t('reviews.reviewTextPlaceholder')}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() =>
                createMutation.mutate({
                  ...form,
                  stayDate: form.stayDate || undefined,
                })
              }
              disabled={!form.guestName || !form.reviewText || createMutation.isPending}
              className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-telivity-light-teal disabled:opacity-50"
            >
              {createMutation.isPending ? t('reviews.submitting') : t('reviews.submitAndGenerate')}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm text-telivity-mid-grey hover:text-telivity-navy"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {['', 'pending', 'drafted', 'approved', 'posted'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              filterStatus === s
                ? 'bg-telivity-teal text-white'
                : 'bg-gray-100 text-telivity-slate hover:bg-gray-200'
            }`}
          >
            {s === '' ? t('reviews.all') : reviewStatusLabel(t, s)}
          </button>
        ))}
      </div>

      {/* Reviews List */}
      <div className="space-y-3">
        {reviewList.map((r) => {
          const isExpanded = expandedId === r.id;
          const statusColor = STATUS_COLORS[r.responseStatus] ?? 'default';

          return (
            <div key={r.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div
                className="px-5 py-3 flex items-center gap-4 cursor-pointer hover:bg-gray-50"
                onClick={() => {
                  setExpandedId(isExpanded ? null : r.id);
                  if (!isExpanded && r.responseText) setEditingResponse(r.responseText);
                }}
              >
                <div className="flex-shrink-0">
                  <span className="text-xs font-semibold text-telivity-slate bg-gray-100 px-2 py-1 rounded">
                    {sourceLabel(t, r.source)}
                  </span>
                </div>
                <RatingStars rating={r.rating} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-telivity-navy">{r.guestName}</span>
                  <p className="text-xs text-telivity-mid-grey truncate">{r.reviewText.slice(0, 80)}...</p>
                </div>
                <StatusBadge status={statusColor} label={reviewStatusLabel(t, r.responseStatus)} />
              </div>

              {isExpanded && (
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50">
                  <div className="mb-4">
                    <h3 className="text-xs font-semibold text-telivity-mid-grey uppercase mb-1">{t('reviews.fullReview')}</h3>
                    <p className="text-sm text-telivity-navy whitespace-pre-wrap">{r.reviewText}</p>
                  </div>

                  {r.responseText && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold text-telivity-mid-grey uppercase mb-1">{t('reviews.aiDraftResponse')}</h3>
                      <textarea
                        value={editingResponse}
                        onChange={(e) => setEditingResponse(e.target.value)}
                        rows={6}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    {r.responseStatus === 'drafted' && (
                      <>
                        <button
                          onClick={() =>
                            updateMutation.mutate({
                              id: r.id,
                              data: { responseText: editingResponse, responseStatus: 'approved' },
                            })
                          }
                          className="flex items-center gap-1 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-telivity-light-teal"
                        >
                          <Check size={12} /> {t('reviews.approve')}
                        </button>
                        <button
                          onClick={() =>
                            updateMutation.mutate({
                              id: r.id,
                              data: { responseText: editingResponse },
                            })
                          }
                          className="flex items-center gap-1 bg-gray-200 text-telivity-navy rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-gray-300"
                        >
                          <Edit3 size={12} /> {t('reviews.saveEdit')}
                        </button>
                      </>
                    )}
                    {r.responseStatus === 'approved' && (
                      <button
                        onClick={() =>
                          updateMutation.mutate({
                            id: r.id,
                            data: { responseStatus: 'posted' },
                          })
                        }
                        className="flex items-center gap-1 bg-green-600 text-white rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-green-700"
                      >
                        <Check size={12} /> {t('reviews.markPosted')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {reviewList.length === 0 && (
          <div className="bg-white rounded-xl shadow-sm px-5 py-8 text-center text-sm text-telivity-mid-grey">
            {t('reviews.empty')}
          </div>
        )}
      </div>
    </div>
  );
}
