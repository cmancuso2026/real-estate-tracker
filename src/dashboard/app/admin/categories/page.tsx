'use client';

import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '@/components/finance/api';
import { useConfirm, type Preview } from '@/components/admin/Confirm';

interface Cat {
  id: number;
  name: string;
  archived: boolean;
  is_builtin: boolean;
  protected: boolean;
  transactions: number;
  requires_property: boolean;
  allow_project_tag: boolean;
  default_property_id: number | null;
}
interface Group {
  id: number;
  name: string;
  categories: Cat[];
}
interface Prop {
  id: number;
  name: string;
}

const card = 'rounded-xl border border-gray-200 bg-white shadow-sm';
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm';
const btn = 'rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';

type Edit =
  | { kind: 'rename'; cat: Cat; value: string }
  | { kind: 'move'; cat: Cat; value: string }
  | { kind: 'merge'; cat: Cat; value: string }
  | { kind: 'rename_group'; group: Group; value: string };

export default function AdminCategoriesPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [props, setProps] = useState<Prop[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [newCat, setNewCat] = useState({ name: '', group: '' });
  const [newGroup, setNewGroup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog, showError } = useConfirm();
  // Collapsed groups (remembered in this browser) — collapse them all to see
  // just the group order and move groups around.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('admin-collapsed-groups') ?? '[]');
      if (Array.isArray(saved)) setCollapsed(new Set(saved.map(Number)));
    } catch { /* not remembered */ }
  }, []);
  const saveCollapsed = (next: Set<number>) => {
    setCollapsed(next);
    try { localStorage.setItem('admin-collapsed-groups', JSON.stringify([...next])); } catch { /* not remembered */ }
  };
  const toggleGroup = (id: number) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saveCollapsed(next);
  };
  async function sortPreset(groupsDir: 'asc' | 'desc' | null, catsDir: 'asc' | 'desc' | null) {
    const word = (d: string) => (d === 'desc' ? 'Z→A' : 'A→Z');
    const what = [groupsDir && `groups ${word(groupsDir)}`, catsDir && `categories in every group ${word(catsDir)}`].filter(Boolean).join(' and ');
    if (!confirm(`Sort ${what}? This replaces the order you set with the arrows.`)) return;
    await direct({ op: 'sort', groups: groupsDir, categories: catsDir });
  }

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        financeApi.get<{ groups: Group[] }>('/api/admin/categories'),
        financeApi.get<{ properties: Prop[] }>('/api/finance/property-options'),
      ]);
      setGroups(c.groups);
      setProps(p.properties);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const allCats = groups.flatMap((g) => g.categories);
  const op = (body: Record<string, unknown>) => financeApi.post<Preview>('/api/admin/categories', body);
  /** Preview → confirm → run → reload. */
  const previewed = (title: string, body: Record<string, unknown>, danger = false) =>
    ask({ title, preview: () => op({ ...body, dry_run: true }), run: () => op(body), onDone: load, danger });
  const direct = async (body: Record<string, unknown>) => {
    try {
      await op(body);
      await load();
    } catch (err) {
      showError(err);
    }
  };
  const settings = (cat: Cat, patch: Record<string, unknown>) =>
    financeApi.put<Preview>(`/api/admin/category-settings/${encodeURIComponent(cat.name)}`, patch);

  function toggleRequires(cat: Cat) {
    const on = !cat.requires_property;
    void ask({
      title: `${on ? 'Require' : 'Stop requiring'} a property for “${cat.name}”?`,
      preview: () => settings(cat, { requires_property: on, dry_run: true }),
      run: () => settings(cat, { requires_property: on }),
      onDone: load,
    });
  }
  async function quickSetting(cat: Cat, patch: Record<string, unknown>) {
    try {
      await settings(cat, patch);
      await load();
    } catch (err) {
      showError(err);
    }
  }

  function submitEdit() {
    if (!edit) return;
    const e = edit;
    setEdit(null);
    if (e.kind === 'rename') void previewed(`Rename “${e.cat.name}”?`, { op: 'rename', name: e.cat.name, new_name: e.value });
    if (e.kind === 'move') void previewed(`Move “${e.cat.name}” to ${e.value}?`, { op: 'move', name: e.cat.name, group: e.value });
    if (e.kind === 'merge') void previewed(`Merge “${e.cat.name}” into “${e.value}”?`, { op: 'merge', name: e.cat.name, into: e.value }, true);
    if (e.kind === 'rename_group') void previewed(`Rename group “${e.group.name}”?`, { op: 'rename_group', name: e.group.name, new_name: e.value });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Categories and groups</h2>
        <p className="mt-1 text-sm text-gray-500">
          Renames, moves and merges update every transaction, saved override, rule and mapping in one step. Archived categories
          disappear from dropdowns but stay on past transactions. Categories that are in use can&apos;t be deleted; merge them instead.
        </p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className={`${card} flex flex-wrap items-end gap-3 p-4`}>
        <label className="text-xs text-gray-500">
          New category
          <input
            aria-label="New category name"
            className={`${input} mt-1 block w-48`}
            value={newCat.name}
            onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
            placeholder="e.g. Coffee"
          />
        </label>
        <label className="text-xs text-gray-500">
          Group
          <select
            aria-label="New category group"
            className={`${input} mt-1 block`}
            value={newCat.group}
            onChange={(e) => setNewCat({ ...newCat, group: e.target.value })}
          >
            <option value="">Choose…</option>
            {groups.map((g) => (
              <option key={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        <button
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={!newCat.name.trim() || !newCat.group}
          onClick={async () => {
            await direct({ op: 'add', ...newCat });
            setNewCat({ name: '', group: newCat.group });
          }}
        >
          Add category
        </button>
        <span className="mx-2 h-8 w-px bg-gray-200" />
        <label className="text-xs text-gray-500">
          New group
          <input aria-label="New group name" className={`${input} mt-1 block w-40`} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
        </label>
        <button
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          disabled={!newGroup.trim()}
          onClick={async () => {
            await direct({ op: 'add_group', name: newGroup });
            setNewGroup('');
          }}
        >
          Add group
        </button>
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        </label>
      </div>

      <div className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3`} data-testid="order-toolbar">
        <span className="text-sm font-medium text-gray-700">Order</span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          Groups
          <button className={btn} onClick={() => void sortPreset('asc', null)}>A→Z</button>
          <button className={btn} onClick={() => void sortPreset('desc', null)}>Z→A</button>
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          Categories
          <button className={btn} onClick={() => void sortPreset(null, 'asc')}>A→Z</button>
          <button className={btn} onClick={() => void sortPreset(null, 'desc')}>Z→A</button>
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          Both
          <button className={btn} onClick={() => void sortPreset('asc', 'asc')}>A→Z</button>
          <button className={btn} onClick={() => void sortPreset('desc', 'desc')}>Z→A</button>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button className={btn} onClick={() => saveCollapsed(new Set(groups.map((g) => g.id)))}>Collapse all</button>
          <button className={btn} onClick={() => saveCollapsed(new Set())}>Expand all</button>
        </span>
        <p className="w-full text-xs text-gray-400">
          Or set your own order with the ↑ ↓ arrows on each group and category. Collapse the groups to see and reorder just the groups.
          This order is used in every category dropdown and list.
        </p>
      </div>

      {groups.map((g, gi) => {
        const cats = g.categories.filter((c) => showArchived || !c.archived);
        const isCollapsed = collapsed.has(g.id);
        return (
          <section key={g.id} className={card} data-testid={`group-${g.name}`}>
            <div className={`flex items-center justify-between gap-2 px-4 py-2.5 ${isCollapsed ? '' : 'border-b border-gray-100'}`}>
              {edit?.kind === 'rename_group' && edit.group.id === g.id ? (
                <span className="flex items-center gap-2">
                  <input aria-label="Group name" className={input} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
                  <button className={btn} onClick={submitEdit}>
                    Preview
                  </button>
                  <button className={btn} onClick={() => setEdit(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="flex items-center gap-2 text-left" aria-expanded={!isCollapsed} onClick={() => toggleGroup(g.id)}>
                  <span className="w-3 text-gray-400">{isCollapsed ? '▸' : '▾'}</span>
                  <h3 className="font-semibold">
                    {g.name} <span className="font-normal text-gray-400">({g.categories.filter((c) => !c.archived).length})</span>
                  </h3>
                </button>
              )}
              <span className="inline-flex gap-1">
                <button className={btn} title="Move group up" aria-label={`Move ${g.name} up`} disabled={gi === 0} onClick={() => void direct({ op: 'reorder_group', name: g.name, direction: 'up' })}>
                  ↑
                </button>
                <button className={btn} title="Move group down" aria-label={`Move ${g.name} down`} disabled={gi === groups.length - 1} onClick={() => void direct({ op: 'reorder_group', name: g.name, direction: 'down' })}>
                  ↓
                </button>
                <button className={btn} onClick={() => setEdit({ kind: 'rename_group', group: g, value: g.name })}>
                  Rename group
                </button>
              </span>
            </div>
            {!isCollapsed && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-2 text-left font-medium">Category</th>
                    <th className="px-2 py-2 text-right font-medium">Transactions</th>
                    <th className="px-2 py-2 text-left font-medium">Requires property</th>
                    <th className="px-2 py-2 text-left font-medium">Project tag</th>
                    <th className="px-2 py-2 text-left font-medium">Default property</th>
                    <th className="px-4 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c, i) => (
                    <tr key={c.id} className={`border-t border-gray-100 ${c.archived ? 'bg-gray-50 text-gray-400' : ''}`} data-testid={`cat-${c.name}`}>
                      <td className="px-4 py-2">
                        {edit && edit.kind !== 'rename_group' && edit.cat.id === c.id ? (
                          <span className="flex flex-wrap items-center gap-2">
                            {edit.kind === 'rename' && (
                              <input aria-label="New name" className={input} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
                            )}
                            {edit.kind === 'move' && (
                              <select aria-label="Move to group" className={input} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })}>
                                <option value="">Move to…</option>
                                {groups.filter((x) => x.id !== g.id).map((x) => (
                                  <option key={x.id}>{x.name}</option>
                                ))}
                              </select>
                            )}
                            {edit.kind === 'merge' && (
                              <select aria-label="Merge into" className={input} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })}>
                                <option value="">Merge into…</option>
                                {allCats.filter((x) => x.id !== c.id && !x.archived).map((x) => (
                                  <option key={x.id}>{x.name}</option>
                                ))}
                              </select>
                            )}
                            <button className={btn} disabled={!edit.value.trim()} onClick={submitEdit}>
                              Preview
                            </button>
                            <button className={btn} onClick={() => setEdit(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span>
                            {c.name}
                            {c.archived && <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">archived</span>}
                            {c.is_builtin && <span className="ml-2 text-[10px] text-gray-400">built-in</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular">{c.transactions}</td>
                      <td className="px-2 py-2">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={`Requires property: ${c.name}`}
                            checked={c.requires_property}
                            onChange={() => toggleRequires(c)}
                          />
                          <span className="text-xs text-gray-500">{c.requires_property ? 'Yes' : 'No'}</span>
                        </label>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Allow project tag: ${c.name}`}
                          checked={c.allow_project_tag}
                          onChange={() => void quickSetting(c, { allow_project_tag: !c.allow_project_tag })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          aria-label={`Default property: ${c.name}`}
                          className={`${input} max-w-[12rem] text-xs`}
                          value={c.default_property_id ?? ''}
                          onChange={(e) => void quickSetting(c, { default_property_id: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">None</option>
                          {props.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-1">
                          <button className={btn} title="Move up" disabled={i === 0} onClick={() => void direct({ op: 'reorder', name: c.name, direction: 'up' })}>
                            ↑
                          </button>
                          <button className={btn} title="Move down" disabled={i === cats.length - 1} onClick={() => void direct({ op: 'reorder', name: c.name, direction: 'down' })}>
                            ↓
                          </button>
                          {!c.protected && (
                            <>
                              <button className={btn} onClick={() => setEdit({ kind: 'rename', cat: c, value: c.name })}>
                                Rename
                              </button>
                              <button className={btn} onClick={() => setEdit({ kind: 'move', cat: c, value: '' })}>
                                Move
                              </button>
                              <button className={btn} onClick={() => setEdit({ kind: 'merge', cat: c, value: '' })}>
                                Merge
                              </button>
                              <button
                                className={btn}
                                onClick={() => void previewed(`${c.archived ? 'Restore' : 'Archive'} “${c.name}”?`, { op: c.archived ? 'unarchive' : 'archive', name: c.name })}
                              >
                                {c.archived ? 'Restore' : 'Archive'}
                              </button>
                              <button
                                className={`${btn} text-red-600`}
                                title={c.transactions ? 'In use: merge it into another category instead' : 'Delete'}
                                onClick={() => void previewed(`Delete “${c.name}”?`, { op: 'delete', name: c.name }, true)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </section>
        );
      })}
      {dialog}
    </div>
  );
}
