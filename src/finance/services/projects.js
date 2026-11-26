// Project ↔ transaction links: list a project's transactions, find ones that
// could be linked, and link / unlink them. A link lives on the transaction's
// allocation for the project's property (transaction_allocations.work_order_id),
// so splits keep their amounts and only the share on that property is tagged.
import { applyAttribution, assertProjectTagAllowed } from '../lib/attribution.js';
import { allocationsByTxn, saveAllocations } from '../lib/allocations.js';
import { serializeRows } from './transactions.js';
import { applyFilters, isoDate } from './_query.js';
import { loadTaxonomy } from '../lib/categories.js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const ROW_FIELDS = ['id', 'dedup_hash', 'description', 'category', 'amount'];

async function getProject(knex, id) {
  const wo = await knex('work_orders').where({ id: Number(id) }).first('id', 'property_id', 'project_name', 'unit_id');
  if (!wo) throw httpError(404, `Project ${id} not found`);
  return wo;
}
const toIds = (ids) => {
  if (!Array.isArray(ids) || !ids.length) throw httpError(400, 'Body must include a non-empty "ids" array');
  return [...new Set(ids.map(Number).filter((n) => Number.isInteger(n)))];
};

/** The split as typed, rebuilt from saved allocations (for the re-upload memory). */
function specOf(allocs) {
  const mode = allocs.some((a) => a.input_mode === 'amount') ? 'amount' : 'percent';
  return {
    mode,
    rows: allocs.map((a) => ({
      property_id: a.property_id,
      unit_id: a.unit_id,
      work_order_id: a.work_order_id,
      value: mode === 'amount' ? Math.abs(a.amount) : a.percent ?? 100,
    })),
  };
}

// GET /api/finance/projects/:id/transactions → { transactions } (newest first)
export async function listProjectTransactions(knex, params) {
  const wo = await getProject(knex, params.id);
  const ids = (await knex('transaction_allocations').where({ work_order_id: wo.id }).distinct('transaction_id')).map((r) => r.transaction_id);
  if (!ids.length) return { transactions: [] };
  const rows = await knex('transactions').whereIn('id', ids).orderBy('date', 'desc').orderBy('id', 'desc');
  return { transactions: await serializeRows(knex, rows) };
}

// GET /api/finance/projects/candidates?propertyId=&projectId=&year=&months=&
//   group=&category=&source=&search=&scope=&limit=
// Transactions you could link: not on another project, and (scope) either
// 'available' (no property yet, or on this property — the default),
// 'unassigned' (no property yet) or 'property' (on this property). The same
// filters as the Transactions page; group means the category's current group.
// Newest first. → { transactions (each with on_property), matched, facets:
// { years, sources, groups: [{ name, categories }] } }
export async function projectCandidates(knex, query = {}) {
  const pid = Number(query.propertyId);
  if (!Number.isInteger(pid) || pid <= 0) throw httpError(400, 'propertyId is required');
  const limit = Math.min(Number(query.limit) || 200, 500);
  const projectId = query.projectId ? Number(query.projectId) : null;
  const scope = ['unassigned', 'property'].includes(query.scope) ? query.scope : 'available';
  const tax = await loadTaxonomy(knex);
  const q = applyFilters(knex('transactions'), { year: query.year, months: query.months, category: query.category, source: query.source, search: query.search })
    .orderBy('date', 'desc')
    .orderBy('id', 'desc')
    .limit(5000)
    .select('*');
  if (query.group && !query.category) {
    const g = tax.groups.find((x) => x.name === query.group);
    q.whereIn('category', g ? g.categories.map((c) => c.name) : []);
  }
  const rows = await q;
  const allocs = await allocationsByTxn(knex, rows.map((r) => r.id));
  const out = [];
  let matched = 0;
  for (const r of rows) {
    const a = allocs.get(Number(r.id)) || [];
    if (a.some((x) => x.work_order_id != null && x.work_order_id !== projectId)) continue; // on another project
    if (projectId && a.some((x) => x.work_order_id === projectId)) continue; // already linked here
    const onProp = a.some((x) => x.property_id === pid);
    if (a.length && !onProp) continue; // only on other properties
    if (scope === 'unassigned' && a.length) continue;
    if (scope === 'property' && !onProp) continue;
    matched += 1;
    if (out.length < limit) out.push(r);
  }
  const serialized = await serializeRows(knex, out);
  const [years, sources] = await Promise.all([
    knex('transactions').distinct('date').select('date'),
    knex('transactions').distinct('source').orderBy('source').select('source'),
  ]);
  return {
    transactions: serialized.map((t) => ({ ...t, group: tax.byName.get(t.category)?.group ?? 'Other', on_property: (t.allocations || []).some((x) => x.property_id === pid) })),
    matched,
    facets: {
      years: [...new Set(years.map((r) => isoDate(r.date).slice(0, 4)))].sort().reverse(),
      sources: sources.map((r) => r.source).filter(Boolean),
      groups: tax.groups.map((g) => ({ name: g.name, categories: g.categories.filter((c) => !c.archived).map((c) => c.name) })),
    },
  };
}

// POST /api/finance/projects/:id/transactions — { ids } links each to the
// project. A transaction with no property gets 100% to the project's property;
// one already on that property keeps its split and its share there is tagged.
// Ones only on other properties are skipped. → { linked, skipped, transactions }
export async function linkProjectTransactions(knex, params, body) {
  const wo = await getProject(knex, params.id);
  const ids = toIds(body?.ids);
  const txns = await knex('transactions').whereIn('id', ids).select(ROW_FIELDS);
  if (txns.length !== ids.length) throw httpError(404, 'Some transactions were not found');
  await assertProjectTagAllowed(knex, txns.map((t) => t.category), wo.id);
  const allocs = await allocationsByTxn(knex, ids);
  const skipped = [];
  let linked = 0;
  await knex.transaction(async (trx) => {
    for (const t of txns) {
      const a = allocs.get(Number(t.id)) || [];
      if (!a.length) {
        await applyAttribution(trx, [t], { property_id: wo.property_id, unit_id: wo.unit_id ?? null, work_order_id: wo.id });
        linked += 1;
        continue;
      }
      if (!a.some((x) => x.property_id === wo.property_id)) {
        skipped.push({ id: t.id, description: t.description, reason: 'Assigned to a different property' });
        continue;
      }
      const next = a.map((x) => (x.property_id === wo.property_id ? { ...x, work_order_id: wo.id } : x));
      await saveAllocations(trx, t, next, specOf(next));
      linked += 1;
    }
  });
  const rows = await knex('transactions').whereIn('id', ids);
  return { linked, skipped, transactions: await serializeRows(knex, rows) };
}

// DELETE /api/finance/projects/:id/transactions — { ids } takes them off the
// project. They stay on the property. → { unlinked, transactions }
export async function unlinkProjectTransactions(knex, params, body) {
  const wo = await getProject(knex, params.id);
  const ids = toIds(body?.ids);
  const txns = await knex('transactions').whereIn('id', ids).select(ROW_FIELDS);
  const allocs = await allocationsByTxn(knex, ids);
  let unlinked = 0;
  await knex.transaction(async (trx) => {
    for (const t of txns) {
      const a = allocs.get(Number(t.id)) || [];
      if (!a.some((x) => x.work_order_id === wo.id)) continue;
      const next = a.map((x) => (x.work_order_id === wo.id ? { ...x, work_order_id: null } : x));
      await saveAllocations(trx, t, next, specOf(next));
      unlinked += 1;
    }
  });
  return { unlinked, transactions: await serializeRows(knex, await knex('transactions').whereIn('id', ids)) };
}
