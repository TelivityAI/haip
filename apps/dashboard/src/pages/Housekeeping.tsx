import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, LayoutGrid, List, Play, CheckCircle, Eye, UserPlus, Zap, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import StatusBadge from '../components/ui/StatusBadge';
import KpiCard from '../components/ui/KpiCard';
import Modal from '../components/ui/Modal';

interface Task {
  id: string;
  roomId: string;
  roomNumber?: string;
  type: string;
  status: string;
  priority: number;
  assignedTo?: string;
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  serviceDate: string;
  checklist?: { item: string; checked: boolean }[];
  maintenanceRequired?: boolean;
  maintenanceNotes?: string;
  notes?: string;
}

const TASK_COLUMNS = ['pending', 'assigned', 'in_progress', 'completed', 'inspected'];

// ---- Dashboard ----
function HousekeepingDashboard() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: dashData } = useQuery({
    queryKey: ['housekeeping', 'dashboard', propertyId, today],
    queryFn: () => api.get('/v1/housekeeping/dashboard', { params: { propertyId, serviceDate: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const dash = dashData?.data ?? dashData ?? {};
  const taskSummary = dash.taskSummary ?? {};

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard title={t('housekeeping.pending')} value={taskSummary.pending ?? 0} icon={Sparkles} />
        <KpiCard title={t('housekeeping.inProgress')} value={taskSummary.in_progress ?? 0} icon={Play} />
        <KpiCard title={t('housekeeping.completed')} value={taskSummary.completed ?? 0} icon={CheckCircle} />
        <KpiCard title={t('housekeeping.inspected')} value={taskSummary.inspected ?? 0} icon={Eye} />
      </div>
    </div>
  );
}

// ---- Task Board / List ----
function TaskBoard() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [taskDetail, setTaskDetail] = useState<Task | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(today);

  const { data } = useQuery({
    queryKey: ['housekeeping', 'tasks', propertyId, statusFilter, dateFilter],
    queryFn: () => api.get('/v1/housekeeping/tasks', { params: { propertyId, status: statusFilter || undefined, serviceDate: dateFilter || undefined } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const tasks: Task[] = data?.data ?? data ?? [];

  const actionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: Record<string, unknown> }) =>
      api.patch(`/v1/housekeeping/tasks/${id}/${action}`, body ?? {}, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
      setTaskDetail(null);
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/v1/housekeeping/generate-stayover-tasks', { propertyId, serviceDate: today }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['housekeeping'] }),
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', propertyId],
    queryFn: () => api.get('/v1/admin/users', { params: { propertyId } }).then((r) => r.data),
    enabled: !!propertyId,
  });
  const housekeeperIds = ((usersData as { id: string }[]) ?? []).map((u) => u.id);

  const autoAssignMutation = useMutation({
    mutationFn: () => {
      if (housekeeperIds.length === 0) {
        throw new Error(t('housekeeping.noStaffForAutoAssign'));
      }
      return api.post('/v1/housekeeping/auto-assign', {
        propertyId,
        serviceDate: today,
        housekeepers: housekeeperIds,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['housekeeping'] }),
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setView('board')} className={`p-2 ${view === 'board' ? 'bg-telivity-teal text-white' : 'hover:bg-telivity-light-grey'}`}><LayoutGrid size={16} /></button>
          <button onClick={() => setView('list')} className={`p-2 ${view === 'list' ? 'bg-telivity-teal text-white' : 'hover:bg-telivity-light-grey'}`}><List size={16} /></button>
        </div>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="">{t('housekeeping.allStatus')}</option>
          {TASK_COLUMNS.map((s) => <option key={s} value={s}>{t(`housekeeping.statuses.${s}`)}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-telivity-light-grey disabled:opacity-50">
            <Zap size={14} /> {t('housekeeping.generateStayovers')}
          </button>
          <button onClick={() => autoAssignMutation.mutate()} disabled={autoAssignMutation.isPending || housekeeperIds.length === 0} className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-telivity-light-grey disabled:opacity-50">
            <UserPlus size={14} /> {t('housekeeping.autoAssign')}
          </button>
        </div>
      </div>

      {/* Board View */}
      {view === 'board' && (
        <div className="grid grid-cols-5 gap-3">
          {TASK_COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col);
            return (
              <div key={col} className="bg-white rounded-xl shadow-sm p-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-telivity-slate uppercase">{t(`housekeeping.statuses.${col}`)}</h3>
                  <span className="text-xs bg-telivity-light-grey text-telivity-slate rounded-full px-1.5">{colTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {colTasks.map((task) => (
                    <div key={task.id} onClick={() => setTaskDetail(task)} className="border border-gray-100 rounded-lg p-2.5 cursor-pointer hover:border-telivity-teal/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-telivity-navy">{task.roomNumber ?? '—'}</span>
                        {task.priority >= 5 && <span className="text-[10px] bg-telivity-orange text-white rounded px-1">{t('housekeeping.high')}</span>}
                      </div>
                      <p className="text-[10px] text-telivity-mid-grey mt-1">{t(`housekeeping.taskTypes.${task.type}`, { defaultValue: task.type.replace(/_/g, ' ') })}</p>
                      {task.checklist && (
                        <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1">
                          <div
                            className="bg-telivity-teal rounded-full h-1 transition-all"
                            style={{ width: `${(task.checklist.filter((c) => c.checked).length / task.checklist.length) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.room')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.type')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.priority')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.assigned')}</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.checklist')}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, i) => (
                <tr key={task.id} onClick={() => setTaskDetail(task)} className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{task.roomNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{t(`housekeeping.taskTypes.${task.type}`, { defaultValue: task.type.replace(/_/g, ' ') })}</td>
                  <td className="px-4 py-3 text-sm">{task.priority >= 5 ? <StatusBadge status="warning" label={`P${task.priority}`} /> : task.priority}</td>
                  <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">{task.assignedTo ? t('housekeeping.assigned') : '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">
                    {task.checklist ? `${task.checklist.filter((c) => c.checked).length}/${task.checklist.length}` : '—'}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('housekeeping.noTasksFound')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Detail Modal */}
      <Modal open={!!taskDetail} onClose={() => setTaskDetail(null)} title={t('housekeeping.taskForRoom', { number: taskDetail?.roomNumber ?? '—' })} wide>
        {taskDetail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <StatusBadge status={taskDetail.status} />
              <span className="text-sm text-telivity-slate">{t(`housekeeping.taskTypes.${taskDetail.type}`, { defaultValue: taskDetail.type.replace(/_/g, ' ') })}</span>
              {taskDetail.priority >= 5 && <StatusBadge status="warning" label={t('housekeeping.priorityNumber', { priority: taskDetail.priority })} />}
            </div>

            {/* Checklist */}
            {taskDetail.checklist && (
              <div>
                <p className="text-xs font-medium text-telivity-mid-grey mb-2">{t('housekeeping.checklist')}</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {taskDetail.checklist.map((item, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm cursor-pointer py-1">
                      <input type="checkbox" checked={item.checked} readOnly className="rounded border-gray-300" />
                      <span className={item.checked ? 'line-through text-telivity-mid-grey' : ''}>{item.item}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {taskDetail.notes && (
              <div>
                <p className="text-xs font-medium text-telivity-mid-grey mb-1">{t('housekeeping.notes')}</p>
                <p className="text-sm bg-telivity-light-grey rounded-lg p-3">{taskDetail.notes}</p>
              </div>
            )}

            {taskDetail.maintenanceRequired && (
              <div className="bg-telivity-orange/10 rounded-lg p-3">
                <p className="text-sm font-medium text-telivity-orange">{t('housekeeping.maintenanceRequired')}</p>
                {taskDetail.maintenanceNotes && <p className="text-sm text-telivity-slate mt-1">{taskDetail.maintenanceNotes}</p>}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-2">
              {taskDetail.status === 'pending' && (
                <button onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'assign', body: { assignedTo: '00000000-0000-0000-0000-000000000001' } })} className="bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold">{t('housekeeping.assign')}</button>
              )}
              {taskDetail.status === 'assigned' && (
                <button onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'start' })} className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">{t('housekeeping.start')}</button>
              )}
              {taskDetail.status === 'in_progress' && (
                <button onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'complete' })} className="bg-telivity-dark-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">{t('housekeeping.complete')}</button>
              )}
              {taskDetail.status === 'completed' && (
                <>
                  <button onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'inspect', body: { passed: true, inspectedBy: '00000000-0000-0000-0000-000000000001' } })} className="bg-telivity-dark-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">{t('housekeeping.passInspection')}</button>
                  <button onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'inspect', body: { passed: false, inspectedBy: '00000000-0000-0000-0000-000000000001' } })} className="bg-telivity-orange text-white rounded-lg px-4 py-2 text-sm font-semibold">{t('housekeeping.failInspection')}</button>
                </>
              )}
              {['pending', 'assigned'].includes(taskDetail.status) && (
                <button onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'skip' })} className="border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold">{t('housekeeping.skip')}</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---- Analytics ----
function HousekeepingAnalytics() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const today = format(new Date(), 'yyyy-MM-dd');
  const startDate = format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd');

  const { data } = useQuery({
    queryKey: ['housekeeping', 'analytics', propertyId, startDate, today],
    queryFn: () => api.get('/v1/housekeeping/analytics', { params: { propertyId, startDate, endDate: today } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const analytics = data?.data ?? data ?? {};

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard title={t('housekeeping.avgTurnTime')} value={analytics.avgTurnTimeMinutes != null ? t('housekeeping.minutes', { count: Math.round(Number(analytics.avgTurnTimeMinutes)) }) : '—'} icon={Sparkles} />
        <KpiCard title={t('housekeeping.tasksCompleted')} value={analytics.totalTasksCompleted ?? 0} icon={CheckCircle} />
        <KpiCard title={t('housekeeping.inspectionPassRate')} value={analytics.inspectionPassRate != null ? `${Number(analytics.inspectionPassRate).toFixed(0)}%` : '—'} icon={Eye} />
      </div>

      {analytics.byRoomType && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-telivity-navy mb-4">{t('housekeeping.averageCleanTimeByRoomType')}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={analytics.byRoomType}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="roomType" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} label={{ value: t('housekeeping.minutesLabel'), angle: -90, position: 'insideLeft', style: { fontSize: 12 } }} />
              <Tooltip />
              <Bar dataKey="avgTurnTime" fill="#06bdb4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---- Main Router ----
export default function Housekeeping() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'dashboard' | 'tasks' | 'analytics'>('tasks');

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Sparkles size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('housekeeping.title')}</h1>
      </div>

      <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-4">
        {(['dashboard', 'tasks', 'analytics'] as const).map((tabName) => (
          <button
            key={tabName}
            onClick={() => setTab(tabName)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === tabName ? 'bg-telivity-teal text-white' : 'text-telivity-slate hover:bg-telivity-light-grey'
            }`}
          >
            {t(`housekeeping.tabs.${tabName}`)}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <HousekeepingDashboard />}
      {tab === 'tasks' && <TaskBoard />}
      {tab === 'analytics' && <HousekeepingAnalytics />}
    </div>
  );
}
