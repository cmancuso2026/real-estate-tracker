const express = require('express');

const { isoDate } = require('./_query');

const router = express.Router();

// GET /api/years — distinct years that have transactions, descending.
router.get('/', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const rows = await knex('transactions').distinct('date').select('date');
    const years = [...new Set(rows.map((r) => Number(isoDate(r.date).slice(0, 4))))];
    years.sort((a, b) => b - a);
    res.json({ years });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
