import { useState } from 'react';
import { UserPlus, ShieldCheck, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import {
  useUsers,
  useRoles,
  useUserMutations,
  type AdminUser,
  type AdminRole,
} from '../../hooks/useAdmin';

export default function UserSettings({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const { data: users = [], isLoading } = useUsers(propertyId);
  const { data: roles = [] } = useRoles(propertyId);
  const { create, disable, assignRoles } = useUserMutations(propertyId);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submitCreate = () => {
    if (!name.trim() || !email.trim()) return;
    create.mutate(
      { name: name.trim(), email: email.trim(), roleIds: newRoleIds },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setName(''); setEmail(''); setNewRoleIds([]);
        },
      },
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-telivity-navy">{t('admin.users')}</h2>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 bg-telivity-teal text-white rounded-lg px-3 py-1.5 text-sm font-semibold">
          <UserPlus size={15} /> {t('admin.addUser')}
        </button>
      </div>

      <table className="w-full">
        <thead>
          <tr className="bg-telivity-teal/5 border-b border-gray-100">
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('admin.name')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('admin.email')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('admin.status')}</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-telivity-slate uppercase">{t('admin.roles')}</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-telivity-slate uppercase">{t('admin.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u: AdminUser, i: number) => (
            <tr key={u.id} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
              <td className="px-4 py-3 text-sm font-medium text-telivity-navy">{u.name}</td>
              <td className="px-4 py-3 text-sm text-telivity-slate">{u.email}</td>
              <td className="px-4 py-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  u.status === 'active' ? 'bg-telivity-dark-teal/10 text-telivity-dark-teal'
                  : u.status === 'invited' ? 'bg-telivity-yellow/15 text-telivity-orange'
                  : 'bg-gray-100 text-telivity-mid-grey'
                }`}>{u.status}</span>
              </td>
              <td className="px-4 py-3 text-sm text-telivity-slate">
                <div className="flex flex-wrap gap-1">
                  {u.roles.length === 0 && <span className="text-telivity-mid-grey">—</span>}
                  {u.roles.map((r) => (
                    <span key={r.id} className="bg-telivity-light-grey text-telivity-slate text-xs rounded px-1.5 py-0.5">{r.name}</span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <button onClick={() => setEditUser(u)} title={t('admin.editRoles')} className="inline-flex items-center gap-1 text-telivity-teal hover:text-telivity-light-teal text-sm font-medium mr-3">
                  <ShieldCheck size={14} /> {t('admin.roles')}
                </button>
                {u.status !== 'disabled' && (
                  <button onClick={() => disable.mutate(u.id)} title={t('admin.disableUser')} className="inline-flex items-center gap-1 text-red-500 hover:text-red-600 text-sm font-medium">
                    <Ban size={14} /> {t('admin.disable')}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!isLoading && users.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-telivity-mid-grey">{t('admin.noUsersYet')}</td></tr>
          )}
        </tbody>
      </table>

      {/* Create user */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('admin.addUser')}>
        <div className="space-y-4">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('admin.name')} {t('admin.required')}</label><input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('admin.email')} {t('admin.required')}</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div>
            <label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('admin.roles')}</label>
            <RoleChecklist roles={roles} selected={newRoleIds} onToggle={(id) => setNewRoleIds((s) => toggle(s, id))} />
          </div>
          {create.isError && <p className="text-xs text-red-500">{t('admin.couldNotCreateUser')}</p>}
          <button onClick={submitCreate} disabled={!name.trim() || !email.trim() || create.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {create.isPending ? t('admin.creating') : t('admin.createUser')}
          </button>
        </div>
      </Modal>

      {/* Edit roles */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={editUser ? t('admin.rolesForUser', { name: editUser.name }) : ''}>
        {editUser && (
          <EditRoles
            roles={roles}
            initial={editUser.roles.map((r) => r.id)}
            pending={assignRoles.isPending}
            onSave={(roleIds) =>
              assignRoles.mutate({ id: editUser.id, roleIds }, { onSuccess: () => setEditUser(null) })
            }
          />
        )}
      </Modal>
    </div>
  );
}

function RoleChecklist({ roles, selected, onToggle }: { roles: AdminRole[]; selected: string[]; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-100 rounded-lg p-2">
      {roles.map((r) => (
        <label key={r.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
          <input type="checkbox" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} className="accent-telivity-teal" />
          <span className="font-medium text-telivity-navy">{r.name}</span>
          {r.isSystem && <span className="text-[10px] text-telivity-mid-grey uppercase tracking-wide">{t('admin.system')}</span>}
        </label>
      ))}
    </div>
  );
}

function EditRoles({ roles, initial, pending, onSave }: { roles: AdminRole[]; initial: string[]; pending: boolean; onSave: (roleIds: string[]) => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(initial);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="space-y-4">
      <RoleChecklist roles={roles} selected={selected} onToggle={toggle} />
      <button onClick={() => onSave(selected)} disabled={pending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
        {pending ? t('admin.saving') : t('admin.saveRoles')}
      </button>
    </div>
  );
}
