import { applyFilters, isoDate } from './_query.js';
import { resolveGroup } from '../lib/categoryStore.js';
import { recategorizeUncategorized } from '../lib/recategorize.js';
import { applyAttribution, assertProjectTagAllowed, requiresProperty, validateAttribution } from '../lib/attribution.js';
import { syncRentQuietly } from '../lib/rentSync.js';
import { allocationStatus, allocationsByTxn, withAllocations } from '../lib/allocations.js';

export function serialize(row) {
  return {
    id: row.id,
    date: isoDate(row.date),
    description: row.description,
    amount: Number(row.amount),
    source: row.source,
    category: row.category,
    category_group: row.category_group,
    is_manual: !!row.is_manual,
    review_cleared: !!row.review_cleared,
    note: row.note || '',
    confidence_score: row.confidence_score == null ? null : Number(row.confidence_score),
    // Property attribution (transaction_allocations). property_id / unit_id /
    // work_order_id are filled only for a single-property allocation; a split
    // lists every share in allocations.
    ...attributionFields(row.amount, row.allocations || []),
  };
}

function attributionFields(amount, allocs) {
  const one = allocs.length === 1 ? allocs[0] : null;
  const st = allocationStatus(amount, allocs);
  return {
    property_id: one ? one.property_id : null,
    work_order_id: one ? one.work_order_id : null,
    unit_id: one ? one.unit_id : null,
    allocations: allocs.map((a) => ({ property_id: a.property_id, unit_id: a.unit_id, work_order_id: a.work_order_id, amount: a.amount, percent: a.percent, input_mode: a.input_mode })),
    allocated: st.allocated,
    unallocated: allocs.length ? st.unallocated : null,
    fully_allocated: st.full,
  };
}

/** serialize() for rows read from the database: loads their allocations first. */
export async function serializeRows(knex, rows) {
  return (await withAllocations(knex, rows)).map(serialize);
}

/** One transaction by id, serialized with its allocations. */
export async function loadSerialized(knex, id) {
  const row = await knex('transactions').where({ id }).first();
  return row ? (await serializeRows(knex, [row]))[0] : null;
}

// GET /api/finance/transactions — filtered + paginated list.
export async function listTransactions(knex, query) {
  const { year, months, group, category, source, search } = query;
  const limit = Math.min(Number(query.limit) || 500, 100000);
  const offset = Number(query.offset) || 0;

  const filters = { year, months, group, category, source, search };

  const countRow = await applyFilters(knex('transactions'), filters)
    .count({ c: '*' })
    .first();
  const total = Number(countRow.c);

  const rows = await applyFilters(knex('transactions'), filters)
    .orderBy('date', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset)
    .select('*');

  return { transactions: await serializeRows(knex, rows), total };
}

// PUT /api/finance/transactions/bulk-category — override many transactions at once.
// Body: { ids: number[], category }. Persists overrides so re-uploads keep them.
// (Single-segment path, so it never collides with '/:id/category'.)
export async function bulkCategory(knex, body) {
  let { ids, category } = body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('Body must include a non-empty "ids" array');
    e.status = 400;
    throw e;
  }
  const categoryGroup = category ? await resolveGroup(knex, category) : null;
  if (!categoryGroup) {
    const e = new Error(`Invalid category '${category}'`);
    e.status = 400;
    throw e;
  }
  ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n)))];

  const rows = await knex('transactions')
    .whereIn('id', ids)
    .select('id', 'dedup_hash', 'description');

  await knex.transaction(async (trx) => {
    if (rows.length) {
      await trx('transactions')
        .whereIn('id', rows.map((r) => r.id))
        .update({ category, category_group: categoryGroup, is_manual: true, confidence_score: null });
    }
    // Upsert an override per distinct dedup_hash so edits survive re-uploads.
    for (const r of rows) {
      if (!r.dedup_hash) continue;
      await trx('category_overrides')
        .insert({
          dedup_hash: r.dedup_hash,
          description: r.description,
          category,
          category_group: categoryGroup,
          updated_at: trx.fn.now(),
        })
        .onConflict('dedup_hash')
        .merge();
    }
  });

  await syncRentQuietly(knex, rows.map((r) => r.id));
  return { success: true, updated: rows.length, category, category_group: categoryGroup };
}

// PUT /api/finance/transactions/bulk-review — mark many transactions reviewed/cleared
// (or restore them). Body: { ids: number[], cleared: boolean }.
// (Single-segment path, so it never collides with '/:id/review'.)
export async function bulkReview(knex, body) {
  let { ids, cleared } = body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    const e = new Error('Body must include a non-empty "ids" array');
    e.status = 400;
    throw e;
  }
  ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n)))];
  const updated = await knex('transactions')
    .whereIn('id', ids)
    .update({ review_cleared: !!cleared });
  return { success: true, updated, cleared: !!cleared };
}

// POST /api/finance/transactions/recategorize — re-run confidence-based categorization
// over currently-Uncategorized, non-manual rows, learning from the rest of the
// history. Only rows that gain a confident category are re-categorized; user
// overrides (is_manual) are never touched. The bank's raw category/Type column
// isn't stored per-row, so the rule fallback runs description-only here.
export async function recategorizeTransactions(knex) {
  const changedIds = [];
  const { scanned, updated } = await recategorizeUncategorized(knex, { changedIds });
  await syncRentQuietly(knex, changedIds);
  return { success: true, scanned, updated };
}

// PUT /api/finance/transactions/:id/review — dismiss a transaction from the review list
// ("this is fine") or restore it. Body: { cleared: boolean }.
export async function setReview(knex, params, body) {
  const id = Number(params.id);
  const cleared = !!(body && body.cleared);

  const existing = await knex('transactions').where({ id }).first();
  if (!existing) {
    const e = new Error(`Transaction ${id} not found`);
    e.status = 404;
    throw e;
  }
  await knex('transactions').where({ id }).update({ review_cleared: cleared });
  return loadSerialized(knex, id);
}

// PUT /api/finance/transactions/:id/note — attach/update/clear a free-text note.
// Body: { note: string }. An empty string clears it.
export async function setNote(knex, params, body) {
  const id = Number(params.id);
  const note = body && typeof body.note === 'string' ? body.note.trim() : '';

  const existing = await knex('transactions').where({ id }).first();
  if (!existing) {
    const e = new Error(`Transaction ${id} not found`);
    e.status = 404;
    throw e;
  }

  await knex('transactions').where({ id }).update({ note: note || null });
  return loadSerialized(knex, id);
}

// PUT /api/finance/transactions/:id/category — override a transaction's category and
// persist it so re-uploads keep the change.
export async function setCategory(knex, params, body) {
  const id = Number(params.id);
  const { category } = body || {};

  // Trust the taxonomy (built-in + custom) for the group, not the client.
  const categoryGroup = category ? await resolveGroup(knex, category) : null;
  if (!categoryGroup) {
    const e = new Error(`Invalid category '${category}'`);
    e.status = 400;
    throw e;
  }

  const existing = await knex('transactions').where({ id }).first();
  if (!existing) {
    const e = new Error(`Transaction ${id} not found`);
    e.status = 404;
    throw e;
  }

  // Property attribution (rules in category_settings): a category that requires
  // a property can't be chosen unless one is sent now or the row already has one.
  // Optional body fields: property_id, unit_id, work_order_id.
  const sentProperty = body && body.property_id != null && body.property_id !== '';
  const attr = sentProperty ? await validateAttribution(knex, body) : null;
  const allocs = (await allocationsByTxn(knex, [id])).get(id) || [];
  const fullyAllocated = allocationStatus(existing.amount, allocs).full;
  if (!attr && !fullyAllocated && (await requiresProperty(knex, category))) {
    const e = new Error(
      allocs.length
        ? `Category '${category}' requires a property and this transaction is only partly allocated. Finish the split, or send property_id to give it all to one property.`
        : `Category '${category}' requires a property. Send property_id (and optionally unit_id / work_order_id) with the category change.`,
    );
    e.status = 400;
    throw e;
  }
  if (attr) await assertProjectTagAllowed(knex, [category], attr.work_order_id);

  await knex('transactions').where({ id }).update({
    category,
    category_group: categoryGroup,
    is_manual: true,
    confidence_score: null,
  });

  // Upsert the override keyed by dedup_hash.
  if (existing.dedup_hash) {
    const overridePayload = {
      dedup_hash: existing.dedup_hash,
      description: existing.description,
      category,
      category_group: categoryGroup,
      updated_at: knex.fn.now(),
    };
    await knex('category_overrides')
      .insert(overridePayload)
      .onConflict('dedup_hash')
      .merge();
  }

  if (attr) await knex.transaction((trx) => applyAttribution(trx, [existing], attr));
  await syncRentQuietly(knex, [id]);

  return loadSerialized(knex, id);
}

