import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  LayoutGrid,
  List,
  Play,
  CheckCircle,
  Eye,
  UserPlus,
  Zap,
  AlertTriangle,
  Users,
  CalendarClock,
  X,
  Package,
  ClipboardList,
  Plus,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { addDays, format } from 'date-fns';
import { api } from '../lib/api';
import { useProperty } from '../context/PropertyContext';
import { useAuth } from '../context/AuthContext';
import { type AdminUser } from '../hooks/useAdmin';
import StatusBadge from '../components/ui/StatusBadge';
import KpiCard from '../components/ui/KpiCard';
import Modal from '../components/ui/Modal';

interface ChecklistItem {
  item: string;
  checked: boolean;
  notes?: string;
}

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
  checklist?: ChecklistItem[];
  maintenanceRequired?: boolean;
  maintenanceNotes?: string;
  notes?: string;
}

interface RoomSummary {
  total?: number;
  vacant_clean?: number;
  vacant_dirty?: number;
  clean?: number;
  inspected?: number;
  guest_ready?: number;
  occupied?: number;
  out_of_order?: number;
  out_of_service?: number;
}

interface HousekeeperSummaryRow {
  housekeeperId: string;
  tasksAssigned: number;
  tasksCompleted: number;
  tasksInProgress: number;
  avgTurnTimeMinutes: number | null;
}

interface UrgentRoom {
  roomId: string;
  roomNumber?: string;
  floor?: string;
  status?: string;
  taskStatus?: string;
  priority: number;
  reason?: string;
}

interface OpsForecast {
  date: string;
  expectedCheckouts: number;
  expectedStayovers: number;
}

const TASK_COLUMNS = ['pending', 'assigned', 'in_progress', 'completed', 'inspected'];
const HK_ROLE_KEYS = new Set(['housekeeping', 'housekeeping_manager', 'admin']);

const ROOM_STATUS_KEYS = [
  'vacant_clean',
  'vacant_dirty',
  'clean',
  'inspected',
  'guest_ready',
  'occupied',
  'out_of_order',
  'out_of_service',
] as const;

function isHousekeepingStaff(user: AdminUser): boolean {
  return user.status === 'active' && user.roles.some((r) => HK_ROLE_KEYS.has(r.key));
}

// ---- Dashboard ----
function HousekeepingDashboard() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const today = format(new Date(), 'yyyy-MM-dd');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const { data: dashData } = useQuery({
    queryKey: ['housekeeping', 'dashboard', propertyId, today],
    queryFn: () =>
      api
        .get('/v1/housekeeping/dashboard', { params: { propertyId, serviceDate: today } })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const { data: forecastData } = useQuery({
    queryKey: ['housekeeping', 'ops-forecast', propertyId, tomorrow],
    queryFn: () =>
      api
        .get('/v1/housekeeping/ops-forecast', { params: { propertyId, date: tomorrow } })
        .then((r) => {
          const body = r.data as OpsForecast | { data: OpsForecast };
          return 'expectedCheckouts' in body ? body : body.data;
        }),
    enabled: !!propertyId,
  });

  const dash = dashData?.data ?? dashData ?? {};
  const taskSummary = dash.taskSummary ?? {};
  const roomSummary: RoomSummary = dash.roomSummary ?? {};
  const housekeeperSummary: HousekeeperSummaryRow[] = dash.housekeeperSummary ?? [];
  const urgentRooms: UrgentRoom[] = dash.urgentRooms ?? [];
  const forecast: OpsForecast = forecastData ?? {
    date: tomorrow,
    expectedCheckouts: 0,
    expectedStayovers: 0,
  };

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('common.selectProperty')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard title={t('housekeeping.pending')} value={taskSummary.pending ?? 0} icon={Sparkles} />
        <KpiCard title={t('housekeeping.inProgress')} value={taskSummary.in_progress ?? 0} icon={Play} />
        <KpiCard title={t('housekeeping.completed')} value={taskSummary.completed ?? 0} icon={CheckCircle} />
        <KpiCard title={t('housekeeping.inspected')} value={taskSummary.inspected ?? 0} icon={Eye} />
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarClock size={16} className="text-telivity-teal" />
          <h3 className="text-sm font-semibold text-telivity-navy">{t('housekeeping.opsForecast')}</h3>
          <span className="text-xs text-telivity-mid-grey ml-auto">{forecast.date ?? tomorrow}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-100 rounded-lg p-4 text-center">
            <p className="text-xs text-telivity-mid-grey uppercase">{t('housekeeping.expectedCheckouts')}</p>
            <p className="text-2xl font-semibold text-telivity-navy mt-1">{forecast.expectedCheckouts ?? 0}</p>
          </div>
          <div className="border border-gray-100 rounded-lg p-4 text-center">
            <p className="text-xs text-telivity-mid-grey uppercase">{t('housekeeping.expectedStayovers')}</p>
            <p className="text-2xl font-semibold text-telivity-navy mt-1">{forecast.expectedStayovers ?? 0}</p>
          </div>
        </div>
        <p className="text-xs text-telivity-mid-grey mt-3">{t('housekeeping.opsForecastHint')}</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-telivity-navy mb-4">{t('housekeeping.roomSummary')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
          {ROOM_STATUS_KEYS.map((key) => (
            <div key={key} className="border border-gray-100 rounded-lg p-3 text-center">
              <p className="text-xs text-telivity-mid-grey uppercase">{t(`housekeeping.roomStatuses.${key}`)}</p>
              <p className="text-lg font-semibold text-telivity-navy mt-1">{roomSummary[key] ?? 0}</p>
            </div>
          ))}
          <div className="border border-telivity-teal/30 bg-telivity-teal/5 rounded-lg p-3 text-center">
            <p className="text-xs text-telivity-mid-grey uppercase">{t('housekeeping.totalRooms')}</p>
            <p className="text-lg font-semibold text-telivity-navy mt-1">{roomSummary.total ?? 0}</p>
          </div>
        </div>
      </div>

      {urgentRooms.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-telivity-orange" />
            <h3 className="text-sm font-semibold text-telivity-navy">{t('housekeeping.urgentRooms')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-telivity-mid-grey uppercase">
                  <th className="pb-2 pr-4">{t('housekeeping.room')}</th>
                  <th className="pb-2 pr-4">{t('housekeeping.floor')}</th>
                  <th className="pb-2 pr-4">{t('common.status')}</th>
                  <th className="pb-2 pr-4">{t('housekeeping.priority')}</th>
                  <th className="pb-2">{t('housekeeping.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {urgentRooms.map((room) => (
                  <tr key={room.roomId} className="border-b border-gray-50">
                    <td className="py-2 pr-4 font-medium text-telivity-navy">{room.roomNumber ?? '—'}</td>
                    <td className="py-2 pr-4 text-telivity-slate">{room.floor ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={room.taskStatus ?? room.status ?? 'pending'} />
                    </td>
                    <td className="py-2 pr-4">{room.priority}</td>
                    <td className="py-2 text-telivity-slate">{room.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {housekeeperSummary.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-telivity-teal" />
            <h3 className="text-sm font-semibold text-telivity-navy">{t('housekeeping.housekeeperSummary')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-telivity-mid-grey uppercase">
                  <th className="pb-2 pr-4">{t('housekeeping.staff')}</th>
                  <th className="pb-2 pr-4">{t('housekeeping.assigned')}</th>
                  <th className="pb-2 pr-4">{t('housekeeping.inProgress')}</th>
                  <th className="pb-2 pr-4">{t('housekeeping.completed')}</th>
                  <th className="pb-2">{t('housekeeping.avgTurnTime')}</th>
                </tr>
              </thead>
              <tbody>
                {housekeeperSummary.map((hk) => (
                  <tr key={hk.housekeeperId} className="border-b border-gray-50">
                    <td className="py-2 pr-4 font-mono text-xs text-telivity-slate">
                      {hk.housekeeperId.slice(0, 8)}…
                    </td>
                    <td className="py-2 pr-4">{hk.tasksAssigned}</td>
                    <td className="py-2 pr-4">{hk.tasksInProgress}</td>
                    <td className="py-2 pr-4">{hk.tasksCompleted}</td>
                    <td className="py-2">
                      {hk.avgTurnTimeMinutes != null
                        ? t('housekeeping.minutes', { count: Math.round(hk.avgTurnTimeMinutes) })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Task Board / List ----
function TaskBoard() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission('housekeeping.manage');
  const queryClient = useQueryClient();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [taskDetail, setTaskDetail] = useState<Task | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(today);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [editableChecklist, setEditableChecklist] = useState<ChecklistItem[]>([]);
  const [maintenanceRequired, setMaintenanceRequired] = useState(false);
  const [maintenanceNotes, setMaintenanceNotes] = useState('');

  const { data } = useQuery({
    queryKey: ['housekeeping', 'tasks', propertyId, statusFilter, dateFilter],
    queryFn: () =>
      api
        .get('/v1/housekeeping/tasks', {
          params: {
            propertyId,
            status: statusFilter || undefined,
            serviceDate: dateFilter || undefined,
          },
        })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const tasks: Task[] = data?.data ?? data ?? [];

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', propertyId],
    queryFn: () => api.get('/v1/admin/users', { params: { propertyId } }).then((r) => r.data as AdminUser[]),
    enabled: !!propertyId,
  });

  const hkStaff = (usersData ?? []).filter(isHousekeepingStaff);

  const openTaskDetail = (task: Task) => {
    setTaskDetail(task);
    setEditableChecklist(task.checklist ? task.checklist.map((c) => ({ ...c })) : []);
    setMaintenanceRequired(task.maintenanceRequired ?? false);
    setMaintenanceNotes(task.maintenanceNotes ?? '');
    setSelectedStaffId('');
  };

  const actionMutation = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: string; body?: Record<string, unknown> }) =>
      api.patch(`/v1/housekeeping/tasks/${id}/${action}`, body ?? {}, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
      setTaskDetail(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/v1/housekeeping/tasks/${id}`, body, { params: { propertyId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post('/v1/housekeeping/generate-stayover-tasks', { propertyId, serviceDate: today }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['housekeeping'] }),
  });

  const autoAssignMutation = useMutation({
    mutationFn: () => {
      if (hkStaff.length === 0) {
        throw new Error(t('housekeeping.noStaffForAutoAssign'));
      }
      return api.post('/v1/housekeeping/auto-assign', {
        propertyId,
        serviceDate: today,
        housekeepers: hkStaff.map((s) => s.id),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['housekeeping'] }),
  });

  const saveChecklist = () => {
    if (!taskDetail) return;
    updateMutation.mutate({ id: taskDetail.id, body: { checklist: editableChecklist } });
  };

  const toggleChecklistItem = (index: number) => {
    setEditableChecklist((prev) =>
      prev.map((item, i) => (i === index ? { ...item, checked: !item.checked } : item)),
    );
  };

  const staffLabel = (staffId: string) => {
    const staff = hkStaff.find((s) => s.id === staffId);
    return staff ? staff.name || staff.email : staffId.slice(0, 8) + '…';
  };

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('common.selectProperty')}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setView('board')}
            className={`p-2 ${view === 'board' ? 'bg-telivity-teal text-white' : 'hover:bg-telivity-light-grey'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 ${view === 'list' ? 'bg-telivity-teal text-white' : 'hover:bg-telivity-light-grey'}`}
          >
            <List size={16} />
          </button>
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">{t('housekeeping.allStatus')}</option>
          {TASK_COLUMNS.map((s) => (
            <option key={s} value={s}>
              {t(`housekeeping.statuses.${s}`)}
            </option>
          ))}
        </select>
        {canManage && (
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-telivity-light-grey disabled:opacity-50"
            >
              <Zap size={14} /> {t('housekeeping.generateStayovers')}
            </button>
            <button
              onClick={() => autoAssignMutation.mutate()}
              disabled={autoAssignMutation.isPending || hkStaff.length === 0}
              className="flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-telivity-light-grey disabled:opacity-50"
            >
              <UserPlus size={14} /> {t('housekeeping.autoAssign')}
            </button>
          </div>
        )}
      </div>

      {view === 'board' && (
        <div className="grid grid-cols-5 gap-3">
          {TASK_COLUMNS.map((col) => {
            const colTasks = tasks.filter((task) => task.status === col);
            return (
              <div key={col} className="bg-white rounded-xl shadow-sm p-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-telivity-slate uppercase">
                    {t(`housekeeping.statuses.${col}`)}
                  </h3>
                  <span className="text-xs bg-telivity-light-grey text-telivity-slate rounded-full px-1.5">
                    {colTasks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => openTaskDetail(task)}
                      className="border border-gray-100 rounded-lg p-2.5 cursor-pointer hover:border-telivity-teal/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-telivity-navy">{task.roomNumber ?? '—'}</span>
                        {task.priority >= 5 && (
                          <span className="text-[10px] bg-telivity-orange text-white rounded px-1">
                            {t('housekeeping.high')}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-telivity-mid-grey mt-1">
                        {t(`housekeeping.taskTypes.${task.type}`, { defaultValue: task.type.replace(/_/g, ' ') })}
                      </p>
                      {task.checklist && (
                        <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1">
                          <div
                            className="bg-telivity-teal rounded-full h-1 transition-all"
                            style={{
                              width: `${(task.checklist.filter((c) => c.checked).length / task.checklist.length) * 100}%`,
                            }}
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

      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-telivity-teal/5 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">
                  {t('housekeeping.room')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">
                  {t('housekeeping.type')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">
                  {t('housekeeping.priority')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">
                  {t('common.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">
                  {t('housekeeping.assigned')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">
                  {t('housekeeping.checklist')}
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, i) => (
                <tr
                  key={task.id}
                  onClick={() => openTaskDetail(task)}
                  className={`border-b border-gray-50 cursor-pointer hover:bg-telivity-light-grey/50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}
                >
                  <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{task.roomNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">
                    {t(`housekeeping.taskTypes.${task.type}`, { defaultValue: task.type.replace(/_/g, ' ') })}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {task.priority >= 5 ? (
                      <StatusBadge status="warning" label={`P${task.priority}`} />
                    ) : (
                      task.priority
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">
                    {task.assignedTo ? staffLabel(task.assignedTo) : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-telivity-slate">
                    {task.checklist
                      ? `${task.checklist.filter((c) => c.checked).length}/${task.checklist.length}`
                      : '—'}
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">
                    {t('housekeeping.noTasksFound')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!taskDetail}
        onClose={() => setTaskDetail(null)}
        title={t('housekeeping.taskForRoom', { number: taskDetail?.roomNumber ?? '—' })}
        wide
      >
        {taskDetail && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <StatusBadge status={taskDetail.status} />
              <span className="text-sm text-telivity-slate">
                {t(`housekeeping.taskTypes.${taskDetail.type}`, {
                  defaultValue: taskDetail.type.replace(/_/g, ' '),
                })}
              </span>
              {taskDetail.priority >= 5 && (
                <StatusBadge
                  status="warning"
                  label={t('housekeeping.priorityNumber', { priority: taskDetail.priority })}
                />
              )}
            </div>

            {editableChecklist.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-telivity-mid-grey">{t('housekeeping.checklist')}</p>
                  {canManage && !['completed', 'inspected'].includes(taskDetail.status) && (
                    <button
                      onClick={saveChecklist}
                      disabled={updateMutation.isPending}
                      className="text-xs text-telivity-teal font-medium hover:underline disabled:opacity-50"
                    >
                      {t('housekeeping.saveChecklist')}
                    </button>
                  )}
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {editableChecklist.map((item, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm py-1">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        readOnly={!canManage || ['completed', 'inspected'].includes(taskDetail.status)}
                        onChange={() => toggleChecklistItem(i)}
                        className="rounded border-gray-300"
                      />
                      <span className={item.checked ? 'line-through text-telivity-mid-grey' : ''}>
                        {item.item}
                      </span>
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

            {taskDetail.maintenanceRequired && taskDetail.status !== 'in_progress' && (
              <div className="bg-telivity-orange/10 rounded-lg p-3">
                <p className="text-sm font-medium text-telivity-orange">{t('housekeeping.maintenanceRequired')}</p>
                {taskDetail.maintenanceNotes && (
                  <p className="text-sm text-telivity-slate mt-1">{taskDetail.maintenanceNotes}</p>
                )}
              </div>
            )}

            {canManage && taskDetail.status === 'in_progress' && (
              <div className="border border-gray-100 rounded-lg p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={maintenanceRequired}
                    onChange={(e) => setMaintenanceRequired(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  {t('housekeeping.maintenanceRequired')}
                </label>
                {maintenanceRequired && (
                  <textarea
                    value={maintenanceNotes}
                    onChange={(e) => setMaintenanceNotes(e.target.value)}
                    placeholder={t('housekeeping.maintenanceNotesPlaceholder')}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    rows={2}
                  />
                )}
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-2 pt-2">
                {taskDetail.status === 'pending' && (
                  <>
                    <select
                      value={selectedStaffId}
                      onChange={(e) => setSelectedStaffId(e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">{t('housekeeping.selectStaff')}</option>
                      {hkStaff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name || s.email}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() =>
                        selectedStaffId &&
                        actionMutation.mutate({
                          id: taskDetail.id,
                          action: 'assign',
                          body: { assignedTo: selectedStaffId },
                        })
                      }
                      disabled={!selectedStaffId || actionMutation.isPending}
                      className="bg-telivity-deep-blue text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {t('housekeeping.assign')}
                    </button>
                  </>
                )}
                {taskDetail.status === 'assigned' && (
                  <>
                    <button
                      onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'start' })}
                      className="bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold"
                    >
                      {t('housekeeping.start')}
                    </button>
                    <button
                      onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'unassign' })}
                      className="border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold"
                    >
                      {t('housekeeping.unassign')}
                    </button>
                  </>
                )}
                {taskDetail.status === 'in_progress' && (
                  <button
                    onClick={() =>
                      actionMutation.mutate({
                        id: taskDetail.id,
                        action: 'complete',
                        body: {
                          checklist: editableChecklist,
                          maintenanceRequired,
                          maintenanceNotes: maintenanceRequired ? maintenanceNotes : undefined,
                        },
                      })
                    }
                    className="bg-telivity-dark-teal text-white rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    {t('housekeeping.complete')}
                  </button>
                )}
                {taskDetail.status === 'completed' && user?.sub && (
                  <>
                    <button
                      onClick={() =>
                        actionMutation.mutate({
                          id: taskDetail.id,
                          action: 'inspect',
                          body: { passed: true, inspectedBy: user.sub, checklist: editableChecklist },
                        })
                      }
                      className="bg-telivity-dark-teal text-white rounded-lg px-4 py-2 text-sm font-semibold"
                    >
                      {t('housekeeping.passInspection')}
                    </button>
                    <button
                      onClick={() =>
                        actionMutation.mutate({
                          id: taskDetail.id,
                          action: 'inspect',
                          body: { passed: false, inspectedBy: user.sub },
                        })
                      }
                      className="bg-telivity-orange text-white rounded-lg px-4 py-2 text-sm font-semibold"
                    >
                      {t('housekeeping.failInspection')}
                    </button>
                  </>
                )}
                {['pending', 'assigned'].includes(taskDetail.status) && (
                  <button
                    onClick={() => actionMutation.mutate({ id: taskDetail.id, action: 'skip' })}
                    className="border border-gray-200 text-telivity-slate rounded-lg px-4 py-2 text-sm font-semibold"
                  >
                    {t('housekeeping.skip')}
                  </button>
                )}
              </div>
            )}
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
  const startDate = format(addDays(new Date(), -30), 'yyyy-MM-dd');

  const { data } = useQuery({
    queryKey: ['housekeeping', 'analytics', propertyId, startDate, today],
    queryFn: () =>
      api
        .get('/v1/housekeeping/analytics', { params: { propertyId, startDate, endDate: today } })
        .then((r) => r.data),
    enabled: !!propertyId,
  });

  const analytics = data?.data ?? data ?? {};
  const metrics = analytics.metrics ?? {};
  const chartData = (analytics.byRoomType ?? []).map(
    (row: { roomTypeName?: string; avgTurnTimeMinutes?: number }) => ({
      roomType: row.roomTypeName ?? '—',
      avgTurnTime: row.avgTurnTimeMinutes ?? 0,
    }),
  );

  if (!propertyId) {
    return (
      <div className="flex items-center justify-center h-64 text-telivity-mid-grey">
        {t('common.selectProperty')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          title={t('housekeeping.avgTurnTime')}
          value={
            metrics.avgTurnTimeMinutes != null
              ? t('housekeeping.minutes', { count: Math.round(Number(metrics.avgTurnTimeMinutes)) })
              : '—'
          }
          icon={Sparkles}
        />
        <KpiCard
          title={t('housekeeping.tasksCompleted')}
          value={metrics.totalTasksCompleted ?? 0}
          icon={CheckCircle}
        />
        <KpiCard
          title={t('housekeeping.inspectionPassRate')}
          value={
            metrics.inspectionPassRate != null
              ? `${(Number(metrics.inspectionPassRate) * 100).toFixed(0)}%`
              : '—'
          }
          icon={Eye}
        />
        <KpiCard
          title={t('housekeeping.maintenanceRate')}
          value={
            metrics.maintenanceIssueRate != null
              ? `${(Number(metrics.maintenanceIssueRate) * 100).toFixed(0)}%`
              : '—'
          }
          icon={AlertTriangle}
        />
      </div>

      {chartData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-telivity-navy mb-4">
            {t('housekeeping.averageCleanTimeByRoomType')}
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="roomType" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                label={{
                  value: t('housekeeping.minutesLabel'),
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 12 },
                }}
              />
              <Tooltip />
              <Bar dataKey="avgTurnTime" fill="#06bdb4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---- Lost & Found ----
function LostAndFoundPanel() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [description, setDescription] = useState('');

  const { data } = useQuery({
    queryKey: ['lost-and-found', propertyId, statusFilter],
    queryFn: () =>
      api.get('/v1/lost-and-found', { params: { propertyId, status: statusFilter || undefined } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const items = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () => api.post('/v1/lost-and-found', { propertyId, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lost-and-found'] });
      setCreateOpen(false);
      setDescription('');
    },
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('housekeeping.allStatus')}</option>
          {(['held', 'returned', 'disposed'] as const).map((s) => (
            <option key={s} value={s}>{t(`housekeeping.lostFound.statuses.${s}`)}</option>
          ))}
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> {t('housekeeping.lostFound.logItem')}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.lostFound.tagCode')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.lostFound.description')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.lostFound.foundAt')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.lostFound.disposeAfter')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: { id: string; tagCode: string; description: string; status: string; foundAt: string; disposeAfter: string }) => (
              <tr key={item.id} className="border-b border-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{item.tagCode}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{item.description}</td>
                <td className="px-4 py-3"><StatusBadge status={item.status} label={t(`housekeeping.lostFound.statuses.${item.status}`, { defaultValue: item.status })} /></td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{format(new Date(item.foundAt), 'yyyy-MM-dd')}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{format(new Date(item.disposeAfter), 'yyyy-MM-dd')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="p-6 text-center text-telivity-mid-grey text-sm">{t('housekeeping.lostFound.noItems')}</p>}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('housekeeping.lostFound.logItem')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('housekeeping.lostFound.description')} *</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" rows={3} />
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!description.trim() || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {createMutation.isPending ? t('common.creating') : t('common.create')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Service Requests ----
function ServiceRequestsPanel() {
  const { t } = useTranslation();
  const { propertyId } = useProperty();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('service_request');

  const { data } = useQuery({
    queryKey: ['service-requests', propertyId, statusFilter],
    queryFn: () =>
      api.get('/v1/service-requests', { params: { propertyId, status: statusFilter || undefined } }).then((r) => r.data),
    enabled: !!propertyId,
  });

  const requests = data?.data ?? data ?? [];

  const createMutation = useMutation({
    mutationFn: () => api.post('/v1/service-requests', { propertyId, title, type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      setCreateOpen(false);
      setTitle('');
    },
  });

  const taskMutation = useMutation({
    mutationFn: (id: string) => api.post(`/v1/service-requests/${id}/create-task`, { propertyId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-requests', 'housekeeping'] }),
  });

  if (!propertyId) {
    return <div className="flex items-center justify-center h-64 text-telivity-mid-grey">{t('common.selectProperty')}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('housekeeping.allStatus')}</option>
          {(['open', 'in_progress', 'done', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>{t(`housekeeping.serviceRequests.statuses.${s}`)}</option>
          ))}
        </select>
        <button onClick={() => setCreateOpen(true)} className="ml-auto flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold">
          <Plus size={16} /> {t('housekeeping.serviceRequests.newRequest')}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-telivity-teal/5 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.title', { defaultValue: 'Title' })}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('housekeeping.type')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('common.status')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase"></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req: { id: string; title: string; type: string; status: string; linkedTaskId?: string; roomId?: string }) => (
              <tr key={req.id} className="border-b border-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{req.title}</td>
                <td className="px-4 py-3 text-sm text-telivity-slate">{t(`housekeeping.serviceRequests.types.${req.type}`, { defaultValue: req.type })}</td>
                <td className="px-4 py-3"><StatusBadge status={req.status} label={t(`housekeeping.serviceRequests.statuses.${req.status}`, { defaultValue: req.status })} /></td>
                <td className="px-4 py-3 text-right">
                  {!req.linkedTaskId && req.roomId && req.status === 'open' && (
                    <button onClick={() => taskMutation.mutate(req.id)} disabled={taskMutation.isPending} className="text-xs text-telivity-teal font-medium hover:underline">
                      {t('housekeeping.serviceRequests.createTask')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {requests.length === 0 && <p className="p-6 text-center text-telivity-mid-grey text-sm">{t('housekeeping.serviceRequests.noRequests')}</p>}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('housekeeping.serviceRequests.newRequest')}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('common.title', { defaultValue: 'Title' })} *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" />
          </div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('housekeeping.type')}</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {(['maintenance', 'turndown', 'deep_clean', 'service_request'] as const).map((tp) => (
                <option key={tp} value={tp}>{t(`housekeeping.serviceRequests.types.${tp}`)}</option>
              ))}
            </select>
          </div>
          <button onClick={() => createMutation.mutate()} disabled={!title.trim() || createMutation.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {createMutation.isPending ? t('common.creating') : t('common.create')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Main Router ----
export default function Housekeeping() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'dashboard' | 'tasks' | 'analytics' | 'lostFound' | 'serviceRequests'>('tasks');

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Sparkles size={24} className="text-telivity-teal" />
        <h1 className="text-2xl font-semibold text-telivity-navy">{t('housekeeping.title')}</h1>
      </div>

      <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1 mb-4">
        {(['dashboard', 'tasks', 'lostFound', 'serviceRequests', 'analytics'] as const).map((tabName) => (
          <button
            key={tabName}
            onClick={() => setTab(tabName)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === tabName ? 'bg-telivity-teal text-white' : 'text-telivity-slate hover:bg-telivity-light-grey'
            }`}
          >
            {tabName === 'lostFound' && <Package size={14} className="inline mr-1" />}
            {tabName === 'serviceRequests' && <ClipboardList size={14} className="inline mr-1" />}
            {t(`housekeeping.tabs.${tabName}`)}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <HousekeepingDashboard />}
      {tab === 'tasks' && <TaskBoard />}
      {tab === 'lostFound' && <LostAndFoundPanel />}
      {tab === 'serviceRequests' && <ServiceRequestsPanel />}
      {tab === 'analytics' && <HousekeepingAnalytics />}
    </div>
  );
}
