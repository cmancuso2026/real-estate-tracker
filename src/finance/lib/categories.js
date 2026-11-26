// The category taxonomy, stored in category_groups / categories (Phase 7).
// lib/taxonomy.js is only the seed source. Admin operations here all support a
// dry run that reports how many rows would change in each table; a real run
// does every change in one DB transaction and writes the change log.
import { GROUPS } from './taxonomy.js';
import { writeAudit } from './audit.js';

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.details = extra;
  return e;
}
const clean = (s) => String(s ?? '').trim();

/**
 * Insert any category that exists but isn't in the table yet: built-ins from
 * lib/taxonomy.js, custom_categories, and categories found on transactions
 * (e.g. after the finance data copy). Never changes existing rows. Idempotent.
 */
export async function syncCategories(knex) {
  const groupNames = Object.keys(GROUPS);
  const groups = new Map((await knex('category_groups').select('id', 'name')).map((g) => [g.name, g.id]));
  const ensureGroup = async (name) => {
    if (groups.has(name)) return groups.get(name);
    const max = await knex('category_groups').max({ m: 'sort_order' }).first();
    const [g] = await knex('category_groups').insert({ name, sort_order: Number(max?.m ?? -1) + 1 }).returning('id');
    groups.set(name, g.id ?? g);
    return groups.get(name);
  };
  // Seeded rows all get position 0, so the default order is A→Z (ties sort by
  // name) — the order the finance pages always used. Reordering in Admin gives
  // a group's categories explicit positions.
  for (let i = 0; i < groupNames.length; i += 1) {
    if (!groups.has(groupNames[i])) {
      const [g] = await knex('category_groups').insert({ name: groupNames[i], sort_order: 0 }).returning('id');
      groups.set(groupNames[i], g.id ?? g);
    }
  }
  const have = new Set((await knex('categories').select('name')).map((c) => c.name));
  for (const a of await knex('category_aliases').select('alias')) have.add(a.alias);
  const inserted = [];
  const add = async (name, groupName, isBuiltin, order) => {
    if (!name || have.has(name)) return;
    const group_id = await ensureGroup(groupName || 'Other');
    await knex('categories').insert({ name, group_id, is_builtin: isBuiltin, archived: false, sort_order: order });
    have.add(name);
    inserted.push(name);
  };
  for (const [g, cats] of Object.entries(GROUPS)) {
    for (let i = 0; i < cats.length; i += 1) await add(cats[i], g, true, 0);
  }
  for (const c of await knex('custom_categories').select('name', 'category_group').orderBy('name')) {
    await add(c.name, c.category_group, false, 0);
  }
  for (const t of await knex('transactions').distinct('category', 'category_group')) {
    await add(t.category, t.category_group, false, 0);
  }
  return inserted;
}

/** Groups (ordered) with their categories, plus name/alias lookups. */
export async function loadTaxonomy(knex) {
  const [groups, cats, aliases] = await Promise.all([
    knex('category_groups').select('*').orderBy('sort_order').orderBy('name'),
    knex('categories').select('*').orderBy('sort_order').orderBy('name'),
    knex('category_aliases as a').join('categories as c', 'c.id', 'a.category_id').select('a.alias', 'c.name'),
  ]);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const byName = new Map(cats.map((c) => [c.name, { ...c, group: groupById.get(c.group_id)?.name ?? 'Other' }]));
  return {
    groups: groups.map((g) => ({ ...g, categories: cats.filter((c) => c.group_id === g.id) })),
    byName,
    aliases: new Map(aliases.map((a) => [a.alias, a.name])),
  };
}

/** The current name for a category name that may have been renamed or merged. */
export function canonicalName(tax, name) {
  if (tax.byName.has(name)) return name;
  return tax.aliases.get(name) ?? name;
}

/** How many rows in each table reference a category name. */
export async function usageCounts(knex, name) {
  const count = async (table, col = 'category') => Number((await knex(table).where(col, name).count({ c: '*' }).first()).c);
  return {
    transactions: await count('transactions'),
    category_overrides: await count('category_overrides'),
    category_settings: await count('category_settings'),
    property_category_map: await count('property_category_map'),
    merchant_rules: await count('merchant_rules'),
  };
}
const total = (counts) => Object.values(counts).reduce((s, n) => s + n, 0);

/** Categories the app relies on by name; they can't be renamed, merged, moved away, archived or deleted. */
export const PROTECTED = new Set(['Uncategorized']);
function assertEditable(c) {
  if (PROTECTED.has(c.name)) throw httpError(400, `“${c.name}” is built in and can't be changed`);
}

async function getCategory(knex, name) {
  const c = await knex('categories as c').join('category_groups as g', 'g.id', 'c.group_id').where('c.name', name).first('c.*', 'g.name as group');
  if (!c) throw httpError(404, `Category '${name}' not found`);
  return c;
}
async function getGroup(knex, name) {
  const g = await knex('category_groups').where({ name }).first();
  if (!g) throw httpError(400, `Group '${name}' not found`);
  return g;
}
async function nameTaken(knex, name) {
  return !!(await knex('categories').where({ name }).first());
}

/**
 * Run an admin operation: `plan` returns { summary, changes, before, after };
 * `apply(trx)` performs it. dryRun → just the plan.
 */
async function runOp(knex, action, dryRun, plan, apply) {
  if (dryRun) return { dry_run: true, ...plan };
  await knex.transaction(async (trx) => {
    await apply(trx);
    await writeAudit(trx, action, plan.summary, plan.before, plan.after);
  });
  return { dry_run: false, ...plan };
}

export async function addCategory(knex, { name, group }, { dryRun = false } = {}) {
  name = clean(name);
  if (!name) throw httpError(400, 'Category name is required');
  if (await nameTaken(knex, name)) throw httpError(400, `Category '${name}' already exists`);
  const g = await getGroup(knex, clean(group));
  const plan = { summary: `Add category “${name}” to ${g.name}`, changes: {}, before: null, after: { name, group: g.name } };
  return runOp(knex, 'category.add', dryRun, plan, async (trx) => {
    const max = await trx('categories').where({ group_id: g.id }).max({ m: 'sort_order' }).first();
    await trx('categories').insert({ name, group_id: g.id, is_builtin: false, archived: false, sort_order: Number(max?.m ?? -1) + 1 });
    await trx('category_aliases').where({ alias: name }).del();
  });
}

export async function addGroup(knex, { name }, { dryRun = false } = {}) {
  name = clean(name);
  if (!name) throw httpError(400, 'Group name is required');
  if (await knex('category_groups').where({ name }).first()) throw httpError(400, `Group '${name}' already exists`);
  const plan = { summary: `Add group “${name}”`, changes: {}, before: null, after: { name } };
  return runOp(knex, 'group.add', dryRun, plan, async (trx) => {
    const max = await trx('category_groups').max({ m: 'sort_order' }).first();
    await trx('category_groups').insert({ name, sort_order: Number(max?.m ?? -1) + 1 });
  });
}

export async function renameGroup(knex, { name, new_name }, { dryRun = false } = {}) {
  const g = await getGroup(knex, clean(name));
  new_name = clean(new_name);
  if (!new_name) throw httpError(400, 'New group name is required');
  if (new_name === g.name) throw httpError(400, 'That is already the name');
  if (await knex('category_groups').where({ name: new_name }).first()) throw httpError(400, `Group '${new_name}' already exists`);
  const changes = {
    transactions: Number((await knex('transactions').where({ category_group: g.name }).count({ c: '*' }).first()).c),
    category_overrides: Number((await knex('category_overrides').where({ category_group: g.name }).count({ c: '*' }).first()).c),
  };
  const plan = { summary: `Rename group “${g.name}” to “${new_name}”`, changes, before: { name: g.name }, after: { name: new_name } };
  return runOp(knex, 'group.rename', dryRun, plan, async (trx) => {
    await trx('category_groups').where({ id: g.id }).update({ name: new_name });
    await trx('transactions').where({ category_group: g.name }).update({ category_group: new_name });
    await trx('category_overrides').where({ category_group: g.name }).update({ category_group: new_name });
    await trx('custom_categories').where({ category_group: g.name }).update({ category_group: new_name });
  });
}

/** Rename: updates transactions, overrides, settings, property map and rules together. */
export async function renameCategory(knex, { name, new_name }, { dryRun = false } = {}) {
  const c = await getCategory(knex, clean(name));
  assertEditable(c);
  new_name = clean(new_name);
  if (!new_name) throw httpError(400, 'New name is required');
  if (new_name === c.name) throw httpError(400, 'That is already the name');
  if (await nameTaken(knex, new_name)) throw httpError(400, `Category '${new_name}' already exists. Merge into it instead.`);
  const changes = await usageCounts(knex, c.name);
  const plan = { summary: `Rename “${c.name}” to “${new_name}”`, changes, before: { name: c.name }, after: { name: new_name } };
  return runOp(knex, 'category.rename', dryRun, plan, async (trx) => {
    await trx('categories').where({ id: c.id }).update({ name: new_name });
    for (const table of ['transactions', 'category_overrides', 'category_settings', 'property_category_map', 'merchant_rules']) {
      await trx(table).where({ category: c.name }).update({ category: new_name });
    }
    await trx('custom_categories').where({ name: c.name }).update({ name: new_name });
    await trx('category_aliases').where({ alias: new_name }).del();
    await trx('category_aliases').insert({ alias: c.name, category_id: c.id });
  });
}

/** Move to another group (transactions and overrides follow). */
export async function moveCategory(knex, { name, group }, { dryRun = false } = {}) {
  const c = await getCategory(knex, clean(name));
  assertEditable(c);
  const g = await getGroup(knex, clean(group));
  if (g.id === c.group_id) throw httpError(400, `“${c.name}” is already in ${g.name}`);
  const { transactions, category_overrides } = await usageCounts(knex, c.name);
  const plan = {
    summary: `Move “${c.name}” from ${c.group} to ${g.name}`,
    changes: { transactions, category_overrides },
    before: { group: c.group },
    after: { group: g.name },
  };
  return runOp(knex, 'category.move', dryRun, plan, async (trx) => {
    const max = await trx('categories').where({ group_id: g.id }).max({ m: 'sort_order' }).first();
    await trx('categories').where({ id: c.id }).update({ group_id: g.id, sort_order: Number(max?.m ?? -1) + 1 });
    await trx('transactions').where({ category: c.name }).update({ category_group: g.name });
    await trx('category_overrides').where({ category: c.name }).update({ category_group: g.name });
    await trx('custom_categories').where({ name: c.name }).update({ category_group: g.name });
  });
}

/** Archive hides a category from dropdowns; history keeps it. */
export async function archiveCategory(knex, { name, archived = true }, { dryRun = false } = {}) {
  const c = await getCategory(knex, clean(name));
  assertEditable(c);
  archived = !!archived;
  if (!!c.archived === archived) throw httpError(400, `“${c.name}” is already ${archived ? 'archived' : 'active'}`);
  const { transactions } = await usageCounts(knex, c.name);
  const plan = {
    summary: `${archived ? 'Archive' : 'Restore'} “${c.name}”${archived ? ` (hidden from dropdowns; ${transactions} transactions keep it)` : ''}`,
    changes: { categories: 1 },
    before: { archived: !!c.archived },
    after: { archived },
  };
  return runOp(knex, archived ? 'category.archive' : 'category.unarchive', dryRun, plan, (trx) =>
    trx('categories').where({ id: c.id }).update({ archived }),
  );
}

/** Move a category one place up or down within its group. */
export async function reorderCategory(knex, { name, direction }) {
  const c = await getCategory(knex, clean(name));
  const sibs = await knex('categories').where({ group_id: c.group_id }).orderBy('sort_order').orderBy('name').select('id', 'name', 'sort_order');
  const i = sibs.findIndex((s) => s.id === c.id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= sibs.length) return { dry_run: false, summary: 'Already at the edge', changes: {} };
  const order = sibs.map((s) => s.id);
  [order[i], order[j]] = [order[j], order[i]];
  const plan = { summary: `Move “${c.name}” ${direction}`, changes: { categories: 2 }, before: { position: i }, after: { position: j } };
  return runOp(knex, 'category.reorder', false, plan, async (trx) => {
    for (let k = 0; k < order.length; k += 1) await trx('categories').where({ id: order[k] }).update({ sort_order: k });
  });
}

/** Move a group one place up or down. */
export async function reorderGroup(knex, { name, direction }) {
  const g = await getGroup(knex, clean(name));
  if (direction !== 'up' && direction !== 'down') throw httpError(400, 'direction must be up or down');
  const all = await knex('category_groups').orderBy('sort_order').orderBy('name').select('id', 'name');
  const i = all.findIndex((x) => x.id === g.id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return { dry_run: false, summary: 'Already at the edge', changes: {} };
  const order = all.map((x) => x.id);
  [order[i], order[j]] = [order[j], order[i]];
  const plan = { summary: `Move group “${g.name}” ${direction}`, changes: { category_groups: 2 }, before: { position: i }, after: { position: j } };
  return runOp(knex, 'group.reorder', false, plan, async (trx) => {
    for (let k = 0; k < order.length; k += 1) await trx('category_groups').where({ id: order[k] }).update({ sort_order: k });
  });
}

/**
 * Sort presets by total amount: put groups and/or the categories inside every
 * group in order of how much money went through them (all time, the size of
 * each category's net total; a group's is the sum of its categories), smallest
 * first ('asc') or largest first ('desc'); ties go A→Z. Leave one out to keep
 * its current order. Your own up/down order is replaced for what you sort.
 */
export async function sortTaxonomy(knex, { groups, categories }) {
  const ok = (v) => v == null || v === '' || v === 'asc' || v === 'desc';
  if (!ok(groups) || !ok(categories)) throw httpError(400, 'groups / categories must be asc or desc');
  if (!groups && !categories) throw httpError(400, 'Pick groups and/or categories to sort');
  const word = (d) => (d === 'desc' ? 'largest total first' : 'smallest total first');
  const what = [groups && `groups ${word(groups)}`, categories && `categories ${word(categories)}`].filter(Boolean).join(', ');
  const plan = { summary: `Sort ${what}`, changes: {}, before: null, after: { groups: groups || null, categories: categories || null } };
  return runOp(knex, 'taxonomy.sort', false, plan, async (trx) => {
    const sums = new Map(
      (await trx('transactions').select('category').sum({ total: 'amount' }).groupBy('category')).map((r) => [r.category, Math.abs(Number(r.total) || 0)]),
    );
    const cmp = (dir) => (a, b) => (dir === 'desc' ? b.total - a.total : a.total - b.total) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const gs = await trx('category_groups').select('id', 'name');
    const catsOf = new Map();
    for (const g of gs) {
      const cs = (await trx('categories').where({ group_id: g.id }).select('id', 'name')).map((c) => ({ ...c, total: sums.get(c.name) ?? 0 }));
      catsOf.set(g.id, cs);
      g.total = cs.reduce((s, c) => s + c.total, 0);
    }
    if (groups) {
      gs.sort(cmp(groups));
      for (let k = 0; k < gs.length; k += 1) await trx('category_groups').where({ id: gs[k].id }).update({ sort_order: k });
    }
    if (categories) {
      for (const g of gs) {
        const cs = catsOf.get(g.id).sort(cmp(categories));
        for (let k = 0; k < cs.length; k += 1) await trx('categories').where({ id: cs[k].id }).update({ sort_order: k });
      }
    }
  });
}

/** Merge: re-point every row from one category to another, then remove it. */
export async function mergeCategory(knex, { name, into }, { dryRun = false } = {}) {
  const src = await getCategory(knex, clean(name));
  assertEditable(src);
  const dst = await getCategory(knex, clean(into));
  if (src.id === dst.id) throw httpError(400, 'Pick a different category to merge into');
  const changes = await usageCounts(knex, src.name);
  const plan = {
    summary: `Merge “${src.name}” into “${dst.name}” (${dst.group})`,
    changes,
    before: { name: src.name, group: src.group },
    after: { name: dst.name, group: dst.group },
  };
  return runOp(knex, 'category.merge', dryRun, plan, async (trx) => {
    await trx('transactions').where({ category: src.name }).update({ category: dst.name, category_group: dst.group });
    await trx('category_overrides').where({ category: src.name }).update({ category: dst.name, category_group: dst.group });
    await trx('merchant_rules').where({ category: src.name }).update({ category: dst.name });
    // The target keeps its own rules/mapping; the source's are dropped.
    await trx('category_settings').where({ category: src.name }).del();
    await trx('property_category_map').where({ category: src.name }).del();
    await trx('custom_categories').where({ name: src.name }).del();
    await trx('category_aliases').where({ category_id: src.id }).update({ category_id: dst.id });
    await trx('categories').where({ id: src.id }).del();
    await trx('category_aliases').insert({ alias: src.name, category_id: dst.id });
  });
}

/** Delete an unused category. In use → 409 with the counts; merge it instead. */
export async function deleteCategory(knex, { name }, { dryRun = false } = {}) {
  const c = await getCategory(knex, clean(name));
  assertEditable(c);
  const changes = await usageCounts(knex, c.name);
  if (total(changes)) {
    throw httpError(409, `“${c.name}” is in use (${changes.transactions} transactions). Merge it into another category instead.`, { changes });
  }
  const plan = { summary: `Delete “${c.name}”`, changes: { categories: 1 }, before: { name: c.name, group: c.group }, after: null };
  return runOp(knex, 'category.delete', dryRun, plan, async (trx) => {
    await trx('custom_categories').where({ name: c.name }).del();
    await trx('categories').where({ id: c.id }).del();
  });
}
