// Attribution service — the logic behind the /api/finance attribution routes:
// tagging transactions with a property (and optionally a project and unit), the
// Needs-property queue, suggestions, and spend roll-ups for properties and
// projects. Rules come from category_settings via lib/attribution.js.
import {
  applyAttribution,
  assertProjectTagAllowed,
  unattributedCount,
  unattributedQuery,
  validateAttribution,
} from '../lib/attribution.js';
import { buildSuggestionContext, suggestFor } from '../lib/suggest.js';
import { isoDate } from './_query.js';
import { serialize } from './transactions.js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const ROW_FIELDS = ['id', 'dedup_hash', 'description', 'category'];

// PATCH /api/finance/transactions/:id/attribution — { property_id, unit_id?, work_order_id? }.
// property_id null clears it. → the updated transaction
export async function setTransactionAttribution(knex, params, body) {
  const id = Number(params.id);
  const existing = await knex('transactions').where({ id }).first(ROW_FIELDS);
  if (!existing) throw httpError(404, `Transaction ${id} not found`);
  if (!body || !('property_id' in body)) throw httpError(400, 'Body must include property_id (null to clear)');
  const attr = await validateAttribution(knex, body);
  await assertProjectTagAllowed(knex, [existing.category], attr.work_order_id);
  await knex.transaction((trx) => applyAttribution(trx, [existing], attr));
  return serialize(await knex('transactions').where({ id }).first());
}

// PATCH /api/finance/transactions/attribution — { ids: number[], property_id, work_order_id?, unit_id? }.
export async function bulkAttribution(knex, body) {
  let { ids } = body || {};
  if (!Array.isArray(ids) || ids.length === 0) throw httpError(400, 'Body must include a non-empty "ids" array');
  if (!body || body.property_id == null || body.property_id === '') throw httpError(400, 'property_id is required');
  ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n)))];
  const attr = await validateAttribution(knex, body);
  const rows = await knex('transactions').whereIn('id', ids).select(ROW_FIELDS);
  await assertProjectTagAllowed(knex, rows.map((r) => r.category), attr.work_order_id);
  await knex.transaction((trx) => applyAttribution(trx, rows, attr));
  return { success: true, updated: rows.length, ...attr };
}

// POST /api/finance/transactions/:id/project — { property_id, unit_id?, project_name? }.
// Creates an 'open' project (work_order) named after the transaction, with the
// amount as its starting cost, and links the transaction to it.
export async function createProjectFromTransaction(knex, params, body) {
  const id = Number(params.id);
  const t = await knex('transactions').where({ id }).first([...ROW_FIELDS, 'amount', 'date']);
  if (!t) throw httpError(404, `Transaction ${id} not found`);
  const base = await validateAttribution(knex, { property_id: body?.property_id, unit_id: body?.unit_id });
  if (!base.property_id) throw httpError(400, 'property_id is required');
  await assertProjectTagAllowed(knex, [t.category], 'new project');
  const name = String(body?.project_name || t.description).trim().slice(0, 200);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  return knex.transaction(async (trx) => {
    const [wo] = await trx('work_orders')
      .insert({
        property_id: base.property_id,
        unit_id: base.unit_id,
        project_name: name,
        description: `Created from transaction on ${isoDate(t.date)}: ${t.description}`,
        status: 'open',
        date_received: isoDate(t.date),
        quoted_cost: Math.round(Math.abs(Number(t.amount))), // starting cost, whole dollars
        source: 'finance',
        created_at: now,
        updated_at: now,
      })
      .returning('*');
    await applyAttribution(trx, [t], { ...base, work_order_id: wo.id });
    return { work_order: wo, transaction: serialize(await trx('transactions').where({ id }).first()) };
  });
}

// GET /api/finance/transactions/:id/suggestions → { suggestions: [...] } (best first)
export async function getSuggestions(knex, params) {
  const id = Number(params.id);
  const t = await knex('transactions').where({ id }).first(['description', 'category']);
  if (!t) throw httpError(404, `Transaction ${id} not found`);
  return { suggestions: suggestFor(await buildSuggestionContext(knex), t) };
}

// GET /api/finance/attribution/queue?category= — unattributed rows, newest first,
// each with its best suggestion. → { count, by_category, transactions }
export async function getQueue(knex, query = {}) {
  const byCategory = await unattributedQuery(knex)
    .select('t.category')
    .count({ c: '*' })
    .groupBy('t.category')
    .orderBy('t.category');
  const q = unattributedQuery(knex).select('t.*').orderBy('t.date', 'desc').orderBy('t.id', 'desc');
  if (query.category) q.where('t.category', query.category);
  const rows = await q;
  const ctx = await buildSuggestionContext(knex);
  return {
    count: byCategory.reduce((s, r) => s + Number(r.c), 0),
    by_category: byCategory.map((r) => ({ category: r.category, count: Number(r.c) })),
    transactions: rows.map((r) => ({ ...serialize(r), suggestion: suggestFor(ctx, r)[0] || null })),
  };
}

// GET /api/finance/attribution/count → { count } (nav badge)
export async function getQueueCount(knex) {
  return { count: await unattributedCount(knex) };
}

// Re-score suggestions for every queued row (used by the Admin "re-run" button
// in Phase 7). Never saves anything. → { count, with_suggestion }
export async function rerunSuggestions(knex) {
  const rows = await unattributedQuery(knex).select('t.description', 't.category');
  const ctx = await buildSuggestionContext(knex);
  return { count: rows.length, with_suggestion: rows.filter((r) => suggestFor(ctx, r).length > 0).length };
}

// GET /api/finance/property-options → properties with units and projects, for
// the attribution pickers. Projects: received/open first, then completed.
export async function getPropertyOptions(knex) {
  const [props, units, wos] = await Promise.all([
    knex('owned_properties').select('id', 'address').orderBy('id'),
    knex('units').select('id', 'property_id', 'unit_label').orderBy('unit_label'),
    knex('work_orders').select('id', 'property_id', 'project_name', 'description', 'status', 'created_at').orderBy('id', 'desc'),
  ]);
  const rank = (s) => (s === 'received' || s === 'open' ? 0 : 1);
  return {
    properties: props.map((p) => ({
      id: p.id,
      name: p.address,
      units: units.filter((u) => u.property_id === p.id).map((u) => ({ id: u.id, label: u.unit_label })),
      projects: wos
        .filter((w) => w.property_id === p.id)
        .sort((a, b) => rank(a.status) - rank(b.status) || b.id - a.id)
        .map((w) => ({ id: w.id, name: w.project_name || w.description || `Project #${w.id}`, status: w.status })),
    })),
  };
}

// GET /api/finance/rollups/property/:id?year= — transactions linked to a
// property, with per-category totals by month and year-to-date.
export async function getPropertySpend(knex, params, query = {}) {
  const id = Number(params.id);
  const year = String(query.year || new Date().getFullYear());
  const rows = await knex('transactions as t')
    .leftJoin('work_orders as w', 'w.id', 't.work_order_id')
    .leftJoin('units as u', 'u.id', 't.unit_id')
    .where('t.property_id', id)
    .select('t.*', 'w.project_name', 'u.unit_label')
    .orderBy('t.date', 'desc')
    .orderBy('t.id', 'desc');
  const months = {}; // 'YYYY-MM' → { category → amount }
  const ytd = {}; // category → amount
  for (const r of rows) {
    const d = isoDate(r.date);
    if (d.slice(0, 4) !== year) continue;
    const ym = d.slice(0, 7);
    const amt = Number(r.amount);
    (months[ym] = months[ym] || {})[r.category] = Math.round(((months[ym][r.category] || 0) + amt) * 100) / 100;
    ytd[r.category] = Math.round(((ytd[r.category] || 0) + amt) * 100) / 100;
  }
  return {
    property_id: id,
    year: Number(year),
    ytd,
    ytd_total: Math.round(Object.values(ytd).reduce((s, v) => s + v, 0) * 100) / 100,
    months,
    transactions: rows.map((r) => ({ ...serialize(r), project_name: r.project_name || null, unit_label: r.unit_label || null })),
  };
}

// GET /api/finance/rollups/projects?propertyId= — actual spend per project:
// the sum of linked transactions, as a positive cost (refunds reduce it).
// → { projects: { [work_order_id]: { actual_spend, transaction_count } } }
export async function getProjectSpend(knex, query = {}) {
  // Summed in JS (like summary.js): portable, and the per-property row count is small.
  // Filter the property in SQL and skip unlinked rows here: pg-mem (the test
  // database) mis-answers IS NOT NULL combined with an equality on two indexed
  // columns, and the result is the same on real Postgres.
  const q = query.propertyId
    ? knex('transactions').where('property_id', Number(query.propertyId)).select('work_order_id', 'amount')
    : knex('transactions').whereNotNull('work_order_id').select('work_order_id', 'amount');
  const projects = {};
  for (const r of await q) {
    if (r.work_order_id == null) continue;
    const p = (projects[r.work_order_id] = projects[r.work_order_id] || { actual_spend: 0, transaction_count: 0 });
    p.actual_spend = Math.round((p.actual_spend - Number(r.amount)) * 100) / 100;
    p.transaction_count += 1;
  }
  return { projects };
}
