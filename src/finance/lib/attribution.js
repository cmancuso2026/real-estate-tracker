// Property / project attribution rules. Every enforcement check reads the
// per-category rules from the category_settings table through the helpers here
// — nothing about which categories need a property is hardcoded in code.
//
// A transaction is "unattributed" (in the Needs-property queue) when its
// category requires a property and its allocations (lib/allocations.js) don't
// add up to its amount — none at all, or a partial split. The queue is computed, never
// stored, so turning requires_property on immediately queues that category's
// existing unattributed rows, and turning it off removes them while keeping
// any attribution already saved.

import { computeAllocations, saveAllocations, singleSpec } from './allocations.js';

/** Defaults for a category with no category_settings row. */
export const DEFAULT_SETTING = Object.freeze({
  requires_property: false,
  allow_project_tag: true,
  default_property_id: null,
});

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** The rules for one category (defaults when it has no row). */
export async function getCategorySetting(knex, category) {
  const row = await knex('category_settings').where({ category }).first();
  return {
    category,
    requires_property: row ? !!row.requires_property : DEFAULT_SETTING.requires_property,
    allow_project_tag: row ? !!row.allow_project_tag : DEFAULT_SETTING.allow_project_tag,
    default_property_id: row && row.default_property_id != null ? Number(row.default_property_id) : null,
  };
}

/** Does this category require a property? The one check every caller uses. */
export async function requiresProperty(knex, category) {
  return (await getCategorySetting(knex, category)).requires_property;
}

/** Every category_settings row. */
export async function listCategorySettings(knex) {
  const rows = await knex('category_settings').select('*').orderBy('category');
  return rows.map((r) => ({
    category: r.category,
    requires_property: !!r.requires_property,
    allow_project_tag: !!r.allow_project_tag,
    default_property_id: r.default_property_id != null ? Number(r.default_property_id) : null,
    updated_at: r.updated_at,
  }));
}

/**
 * Create or update a category's rules. `patch` may hold requires_property,
 * allow_project_tag, default_property_id. Returns the new setting plus how many
 * transactions of that category are unattributed after the change (the queue).
 */
export async function setCategorySetting(knex, category, patch = {}) {
  if (!category || typeof category !== 'string') throw httpError(400, 'category is required');
  const cur = await getCategorySetting(knex, category);
  const next = { ...cur };
  for (const k of ['requires_property', 'allow_project_tag']) {
    if (patch[k] !== undefined) {
      if (typeof patch[k] !== 'boolean') throw httpError(400, `${k} must be true or false`);
      next[k] = patch[k];
    }
  }
  if (patch.default_property_id !== undefined) {
    next.default_property_id = patch.default_property_id == null ? null : await requireProperty(knex, patch.default_property_id);
  }
  const row = {
    category,
    requires_property: next.requires_property,
    allow_project_tag: next.allow_project_tag,
    default_property_id: next.default_property_id,
    updated_at: knex.fn.now(),
  };
  await knex('category_settings').insert(row).onConflict('category').merge();
  const queued = next.requires_property
    ? await notAllocatedCount(knex, category)
    : 0;
  return { setting: await getCategorySetting(knex, category), queued };
}

const toId = (v, name) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, `${name} must be a positive integer`);
  return n;
};

async function requireProperty(knex, id) {
  const pid = toId(id, 'property_id');
  const p = await knex('owned_properties').where({ id: pid }).first('id');
  if (!p) throw httpError(400, `Property ${pid} not found`);
  return pid;
}

/**
 * Validate an attribution: the property exists, and the unit and project (if
 * given) belong to that property. Returns normalized ids. A null property
 * clears the attribution (unit and project must then be empty too).
 */
export async function validateAttribution(knex, { property_id, unit_id, work_order_id } = {}) {
  const unitId = toId(unit_id, 'unit_id');
  const woId = toId(work_order_id, 'work_order_id');
  if (property_id === null || property_id === undefined || property_id === '') {
    if (unitId || woId) throw httpError(400, 'A unit or project needs a property_id');
    return { property_id: null, unit_id: null, work_order_id: null };
  }
  const pid = await requireProperty(knex, property_id);
  if (unitId) {
    const u = await knex('units').where({ id: unitId }).first('property_id');
    if (!u) throw httpError(400, `Unit ${unitId} not found`);
    if (Number(u.property_id) !== pid) throw httpError(400, `Unit ${unitId} does not belong to property ${pid}`);
  }
  if (woId) {
    const w = await knex('work_orders').where({ id: woId }).first('property_id');
    if (!w) throw httpError(400, `Project ${woId} not found`);
    if (Number(w.property_id) !== pid) throw httpError(400, `Project ${woId} does not belong to property ${pid}`);
  }
  return { property_id: pid, unit_id: unitId, work_order_id: woId };
}

/** Reject a project tag on rows whose category has allow_project_tag off. */
export async function assertProjectTagAllowed(knex, categories, workOrderId) {
  if (!workOrderId) return;
  const blocked = [];
  for (const c of [...new Set(categories)]) {
    if (!(await getCategorySetting(knex, c)).allow_project_tag) blocked.push(c);
  }
  if (blocked.length) {
    throw httpError(400, `Project tagging is turned off for: ${blocked.join(', ')}`);
  }
}

/**
 * Give each transaction 100% to one property (or clear it when
 * attr.property_id is null), saved in transaction_allocations and remembered
 * by dedup_hash for re-uploads. `rows` need id, amount, dedup_hash, description.
 */
export async function applyAttribution(trx, rows, attr) {
  if (!rows.length) return 0;
  for (const r of rows) {
    if (attr.property_id == null) {
      await saveAllocations(trx, r, [], null);
      continue;
    }
    const spec = singleSpec(attr);
    await saveAllocations(trx, r, computeAllocations(r.amount, spec.mode, spec.rows), spec);
  }
  return rows.length;
}

/** Sum of allocations per transaction (subquery to join on t.id). */
export function allocatedSubquery(knex) {
  return knex('transaction_allocations').select('transaction_id').sum({ allocated: 'amount' }).groupBy('transaction_id').as('a');
}

/**
 * Query builder for unattributed transactions: the category requires a
 * property and the allocations don't add up to the amount (none, or a partial
 * split). Selects can use a.allocated (null when nothing is allocated).
 */
export function unattributedQuery(knex) {
  return knex('transactions as t')
    .join('category_settings as s', 's.category', 't.category')
    .leftJoin(allocatedSubquery(knex), 'a.transaction_id', 't.id')
    .where('s.requires_property', true)
    .where((q) => q.whereNull('a.allocated').orWhereRaw('a.allocated <> t.amount'));
}

/** How many transactions are waiting for a property. */
export async function unattributedCount(knex) {
  const row = await unattributedQuery(knex).count({ c: '*' }).first();
  return Number(row.c);
}

/** Transactions of a category not fully allocated (whatever its rules say). */
export async function notAllocatedCount(knex, category) {
  const row = await knex('transactions as t')
    .leftJoin(allocatedSubquery(knex), 'a.transaction_id', 't.id')
    .where('t.category', category)
    .where((q) => q.whereNull('a.allocated').orWhereRaw('a.allocated <> t.amount'))
    .count({ c: '*' })
    .first();
  return Number(row.c);
}
