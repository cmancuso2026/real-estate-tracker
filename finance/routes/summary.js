const express = require('express');

const { applyFilters, isoDate } = require('./_query');

const router = express.Router();

// GET /api/summary — aggregate totals for the selected period.
// Aggregation is done in JS over the filtered rows: the dataset is small
// (personal finances) and it keeps the SQL portable.
router.get('/', async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const { year, months } = req.query;

    const rows = await applyFilters(knex('transactions'), { year, months }).select(
      'amount',
      'category',
      'category_group',
      'source',
      'date'
    );

    let income = 0;
    let spending = 0;
    const byGroup = {};
    const byCategory = {};
    const byMonth = {};
    const bySource = {};

    for (const row of rows) {
      const amt = Number(row.amount);
      if (amt > 0) income += amt;
      else spending += Math.abs(amt);

      byGroup[row.category_group] = (byGroup[row.category_group] || 0) + amt;
      byCategory[row.category] = (byCategory[row.category] || 0) + amt;

      const ym = isoDate(row.date).slice(0, 7); // 'YYYY-MM'
      if (!byMonth[ym]) byMonth[ym] = { income: 0, spending: 0 };
      if (amt > 0) byMonth[ym].income += amt;
      else byMonth[ym].spending += Math.abs(amt);

      bySource[row.source] = (bySource[row.source] || 0) + 1;
    }

    const round = (n) => Math.round(n * 100) / 100;
    const roundMap = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)]));
    const roundMonth = (m) =>
      Object.fromEntries(
        Object.entries(m).map(([k, v]) => [
          k,
          { income: round(v.income), spending: round(v.spending) },
        ])
      );

    res.json({
      income: round(income),
      spending: round(spending),
      cash_flow: round(income - spending),
      transaction_count: rows.length,
      by_group: roundMap(byGroup),
      by_category: roundMap(byCategory),
      by_month: roundMonth(byMonth),
      by_source: bySource,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
