import { useMemo, useState } from 'react';
import { Plus, Trash2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import {
  useRoles,
  usePermissionCatalog,
  useRoleMutations,
  type AdminRole,
  type PermissionDef,
} from '../../hooks/useAdmin';

function permissionGroupKey(group: string) {
  return group.replace(/\s+(\w)/g, (_, letter: string) => letter.toUpperCase()).replace(/\s/g, '').replace(/^./, (letter) => letter.toLowerCase());
}

export default function RolesSettings({ propertyId }: { propertyId: string }) {
  const { t } = useTranslation();
  const { data: roles = [] } = useRoles(propertyId);
  const { data: catalog = [] } = usePermissionCatalog(propertyId);
  const { create, remove, setPermissions } = useRoleMutations(propertyId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;

  const groups = useMemo(() => {
    const byGroup: Record<string, PermissionDef[]> = {};
    for (const p of catalog) (byGroup[p.group] ??= []).push(p);
    return byGroup;
  }, [catalog]);

  const submitCreate = () => {
    if (!key.trim() || !name.trim()) return;
    create.mutate(
      { key: key.trim(), name: name.trim(), description: description.trim() || undefined },
      {
        onSuccess: (res: { data?: { id?: string } }) => {
          setCreateOpen(false);
          setKey(''); setName(''); setDescription('');
          setSelectedId(res.data?.id ?? null);
        },
      },
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Role list */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-telivity-navy">{t('admin.roles')}</h2>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1 text-telivity-teal hover:text-telivity-light-teal text-sm font-semibold">
            <Plus size={15} /> {t('admin.new')}
          </button>
        </div>
        <ul>
          {roles.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
                  selected?.id === r.id ? 'bg-telivity-teal/5' : 'hover:bg-telivity-light-grey/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-telivity-navy">{r.name}</span>
                  {r.isSystem && <Lock size={12} className="text-telivity-mid-grey" />}
                </div>
                <p className="text-xs text-telivity-mid-grey">{t('admin.permissionsCount', { count: r.permissions.length })}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Permission matrix */}
      <div className="lg:col-span-2">
        {selected ? (
          <PermissionMatrix
            key={selected.id}
            role={selected}
            groups={groups}
            saving={setPermissions.isPending}
            deleting={remove.isPending}
            onSave={(permissionKeys) => setPermissions.mutate({ id: selected.id, permissionKeys })}
            onDelete={() =>
              remove.mutate(selected.id, { onSuccess: () => setSelectedId(null) })
            }
          />
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-sm text-telivity-mid-grey">{t('admin.selectARole')}</div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('admin.newRole')}>
        <div className="space-y-4">
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('admin.keyLabel')}</label><input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('admin.keyPlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('admin.name')} {t('admin.required')}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('admin.namePlaceholder')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          <div><label className="block text-xs font-medium text-telivity-mid-grey mb-1">{t('admin.description')}</label><input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-telivity-teal" /></div>
          {create.isError && <p className="text-xs text-red-500">{t('admin.couldNotCreateRole')}</p>}
          <button onClick={submitCreate} disabled={!key.trim() || !name.trim() || create.isPending} className="w-full bg-telivity-teal text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {create.isPending ? t('admin.creating') : t('admin.createRole')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function PermissionMatrix({
  role,
  groups,
  saving,
  deleting,
  onSave,
  onDelete,
}: {
  role: AdminRole;
  groups: Record<string, PermissionDef[]>;
  saving: boolean;
  deleting: boolean;
  onSave: (keys: string[]) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(role.permissions);
  const readOnly = role.isSystem;
  const toggle = (key: string) =>
    setSelected((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));

  const dirty =
    selected.length !== role.permissions.length ||
    selected.some((k) => !role.permissions.includes(k));

  return (
    <div className="bg-white rounded-xl shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-telivity-navy flex items-center gap-2">
            {role.name}
            {readOnly && <span className="text-[10px] text-telivity-mid-grey uppercase tracking-wide flex items-center gap-1"><Lock size={11} /> {t('admin.systemRoleReadOnly')}</span>}
          </h2>
          {role.description && <p className="text-xs text-telivity-mid-grey mt-0.5">{role.description}</p>}
        </div>
        {!readOnly && (
          <button onClick={onDelete} disabled={deleting} className="inline-flex items-center gap-1 text-red-500 hover:text-red-600 text-sm font-medium disabled:opacity-50">
            <Trash2 size={14} /> {t('admin.delete')}
          </button>
        )}
      </div>

      <div className="p-5 space-y-5 max-h-[26rem] overflow-y-auto">
        {Object.entries(groups).map(([group, perms]) => (
          <div key={group}>
            <h3 className="text-xs font-semibold text-telivity-mid-grey uppercase tracking-wider mb-2">{t(`permissions.groups.${permissionGroupKey(group)}`, { defaultValue: group })}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {perms.map((p) => (
                <label key={p.key} className={`flex items-center gap-2 text-sm ${readOnly ? 'opacity-80' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={selected.includes(p.key)}
                    onChange={() => toggle(p.key)}
                    className="accent-telivity-teal"
                  />
                  <span className="text-telivity-navy">{t(`permissions.labels.${p.key}`, { defaultValue: p.label })}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
          <button onClick={() => onSave(selected)} disabled={!dirty || saving} className="bg-telivity-teal text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50">
            {saving ? t('admin.saving') : t('admin.savePermissions')}
          </button>
          {dirty && <span className="text-xs text-telivity-orange">{t('admin.unsavedChanges')}</span>}
        </div>
      )}
    </div>
  );
}
