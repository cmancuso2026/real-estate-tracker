import express from 'express';

import { mergedTaxonomy, resolveGroup, BASE_GROUP_NAMES, BASE_CATS } from '../lib/categoryStore.js';

const router = express.Router();

// GET /api/categories — the full taxonomy (built-in + custom), so the frontend
// stays in sync.
router.get('/', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    res.json(await mergedTaxonomy(knex));
  } catch (err) {
    next(err);
  }
});

// POST /api/categories — add a user-defined category to an existing group.
// Body: { name, group }. Returns the updated taxonomy.
router.post('/', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const name = String((req.body && req.body.name) || '').trim();
    const group = String((req.body && req.body.group) || '').trim();

    if (!name) {
      const e = new Error('Category name is required');
      e.status = 400;
      throw e;
    }
    if (!BASE_GROUP_NAMES.includes(group)) {
      const e = new Error(`Invalid group '${group}'. Expected one of: ${BASE_GROUP_NAMES.join(', ')}`);
      e.status = 400;
      throw e;
    }
    // Reject duplicates (built-in or already-added custom).
    if (BASE_CATS.has(name) || (await resolveGroup(knex, name))) {
      const e = new Error(`Category '${name}' already exists`);
      e.status = 400;
      throw e;
    }

    await knex('custom_categories').insert({ name, category_group: group });
    res.status(201).json(await mergedTaxonomy(knex));
  } catch (err) {
    next(err);
  }
});

export default router;
