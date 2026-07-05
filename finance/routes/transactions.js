const express = require('express');

const { applyFilters, isoDate } = require('./_query');
const { groupFor, GROUPS } = require('../lib/taxonomy');

const router = express.Router();

const ALL_CATEGORIES = new Set(Object.values(GROUPS).flat());

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
  };
}

// GET /api/transactions — filtered + paginated list.
router.get('/', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const { year, months, group, category, source, search } = req.query;
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
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
    if (!category || !ALL_CATEGORIES.has(category)) {
      const e = new Error(`Invalid category '${category}'`);
      e.status = 400;
      throw e;
    }
    const categoryGroup = groupFor(category);
    ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n)))];

    const rows = await knex('transactions')
      .whereIn('id', ids)
      .select('id', 'dedup_hash', 'description');

    await knex.transaction(async (trx) => {
      if (rows.length) {
        await trx('transactions')
          .whereIn('id', rows.map((r) => r.id))
          .update({ category, category_group: categoryGroup, is_manual: true });
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

// PUT /api/transactions/:id/category — override a transaction's category and
// persist it so re-uploads keep the change.
router.put('/:id/category', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const id = Number(req.params.id);
    let { category, category_group: categoryGroup } = req.body || {};

    if (!category || !ALL_CATEGORIES.has(category)) {
      const e = new Error(`Invalid category '${category}'`);
      e.status = 400;
      throw e;
    }
    // Trust the taxonomy for the group rather than the client.
    categoryGroup = groupFor(category);

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
