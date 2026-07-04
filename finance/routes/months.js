const express = require('express');

const { isoDate } = require('./_query');

const router = express.Router();

// GET /api/months?year=2026 — month numbers (1-12) with data in that year.
router.get('/', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const { year } = req.query;
    const q = knex('transactions').distinct('date').select('date');
    if (year) q.whereBetween('date', [`${year}-01-01`, `${year}-12-31`]);

    const rows = await q;
    const months = [...new Set(rows.map((r) => Number(isoDate(r.date).slice(5, 7))))];
    months.sort((a, b) => a - b);
    res.json({ months });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
