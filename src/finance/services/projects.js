// Project ↔ transaction links: list a project's transactions, find ones that
// could be linked, and link / unlink them. A link lives on the transaction's
// allocation for the project's property (transaction_allocations.work_order_id),
// so splits keep their amounts and only the share on that property is tagged.
import { applyAttribution, assertProjectTagAllowed } from '../lib/attribution.js';
import { allocationsByTxn, saveAllocations } from '../lib/allocations.js';
import { serializeRows } from './transactions.js';

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

// GET /api/finance/projects/candidates?propertyId=&search=&projectId=&limit=
// Transactions you could link: not on another project, and either not on any
// property yet or (partly) on this property. Newest first. Each row says
// whether it's already on this property.
export async function projectCandidates(knex, query = {}) {
  const pid = Number(query.propertyId);
  if (!Number.isInteger(pid) || pid <= 0) throw httpError(400, 'propertyId is required');
  const limit = Math.min(Number(query.limit) || 100, 500);
  const projectId = query.projectId ? Number(query.projectId) : null;
  const q = knex('transactions').orderBy('date', 'desc').orderBy('id', 'desc').limit(3000).select('*');
  if (query.search) q.whereRaw('LOWER(description) LIKE ?', [`%${String(query.search).toLowerCase()}%`]);
  const rows = await q;
  const allocs = await allocationsByTxn(knex, rows.map((r) => r.id));
  const out = [];
  for (const r of rows) {
    const a = allocs.get(Number(r.id)) || [];
    if (a.some((x) => x.work_order_id != null && x.work_order_id !== projectId)) continue; // on another project
    if (projectId && a.some((x) => x.work_order_id === projectId)) continue; // already linked here
    if (a.length && !a.some((x) => x.property_id === pid)) continue; // only on other properties
    out.push(r);
    if (out.length >= limit) break;
  }
  const serialized = await serializeRows(knex, out);
  return { transactions: serialized.map((t) => ({ ...t, on_property: (t.allocations || []).some((x) => x.property_id === pid) })) };
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
