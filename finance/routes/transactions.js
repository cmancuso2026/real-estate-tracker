const express = require('express');

const { applyFilters, isoDate } = require('./_query');
const { resolveGroup } = require('../lib/categoryStore');
const { recategorizeUncategorized } = require('../lib/recategorize');

const router = express.Router();

function serialize(row) {
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
  };
}

// GET /api/transactions — filtered + paginated list.
router.get('/', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const { year, months, group, category, source, search } = req.query;
    const limit = Math.min(Number(req.query.limit) || 500, 100000);
    const offset = Number(req.query.offset) || 0;

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

    res.json({ transactions: rows.map(serialize), total });
  } catch (err) {
    next(err);
  }
});

// PUT /api/transactions/bulk-category — override many transactions at once.
// Body: { ids: number[], category }. Persists overrides so re-uploads keep them.
// (Single-segment path, so it never collides with '/:id/category'.)
router.put('/bulk-category', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    let { ids, category } = req.body || {};

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

    res.json({ success: true, updated: rows.length, category, category_group: categoryGroup });
  } catch (err) {
    next(err);
  }
});

// PUT /api/transactions/bulk-review — mark many transactions reviewed/cleared
// (or restore them). Body: { ids: number[], cleared: boolean }.
// (Single-segment path, so it never collides with '/:id/review'.)
router.put('/bulk-review', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    let { ids, cleared } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      const e = new Error('Body must include a non-empty "ids" array');
      e.status = 400;
      throw e;
    }
    ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n)))];
    const updated = await knex('transactions')
      .whereIn('id', ids)
      .update({ review_cleared: !!cleared });
    res.json({ success: true, updated, cleared: !!cleared });
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions/recategorize — re-run confidence-based categorization
// over currently-Uncategorized, non-manual rows, learning from the rest of the
// history. Only rows that gain a confident category are re-categorized; user
// overrides (is_manual) are never touched. The bank's raw category/Type column
// isn't stored per-row, so the rule fallback runs description-only here.
router.post('/recategorize', async (req, res, next) => {
  try {
    const { scanned, updated } = await recategorizeUncategorized(req.app.locals.db);
    res.json({ success: true, scanned, updated });
  } catch (err) {
    next(err);
  }
});

// PUT /api/transactions/:id/review — dismiss a transaction from the review list
// ("this is fine") or restore it. Body: { cleared: boolean }.
router.put('/:id/review', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const id = Number(req.params.id);
    const cleared = !!(req.body && req.body.cleared);

    const existing = await knex('transactions').where({ id }).first();
    if (!existing) {
      const e = new Error(`Transaction ${id} not found`);
      e.status = 404;
      throw e;
    }
    await knex('transactions').where({ id }).update({ review_cleared: cleared });
    const updated = await knex('transactions').where({ id }).first();
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

// PUT /api/transactions/:id/note — attach/update/clear a free-text note.
// Body: { note: string }. An empty string clears it.
router.put('/:id/note', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const id = Number(req.params.id);
    const note = req.body && typeof req.body.note === 'string' ? req.body.note.trim() : '';

    const existing = await knex('transactions').where({ id }).first();
    if (!existing) {
      const e = new Error(`Transaction ${id} not found`);
      e.status = 404;
      throw e;
    }

    await knex('transactions').where({ id }).update({ note: note || null });
    const updated = await knex('transactions').where({ id }).first();
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

// PUT /api/transactions/:id/category — override a transaction's category and
// persist it so re-uploads keep the change.
router.put('/:id/category', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const id = Number(req.params.id);
    const { category } = req.body || {};

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

    const updated = await knex('transactions').where({ id }).first();
    res.json(serialize(updated));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
