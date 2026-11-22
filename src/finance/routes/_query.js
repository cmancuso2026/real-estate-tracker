// Shared query helpers used by the transactions, summary, years and months
// routes. Date filtering is expressed as BETWEEN ranges (not EXTRACT) so it
// stays portable and uses the date index.

// Normalize a DB date value ('YYYY-MM-DD' string or Date) to 'YYYY-MM-DD'.
function isoDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// [firstDay, lastDay] for a given year + month (1-12).
function monthRange(year, month) {
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Number(year), Number(month), 0).getDate();
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(lastDay).padStart(2, '0')}`];
}

function parseMonths(months) {
  return String(months || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Apply the standard filter set to a knex query builder. Mutates and returns q.
function applyFilters(q, { year, months, group, category, source, search } = {}) {
  const monthList = parseMonths(months);
  if (year && monthList.length) {
    q.where((b) => {
      monthList.forEach((m) => b.orWhereBetween('date', monthRange(year, m)));
    });
  } else if (year) {
    q.whereBetween('date', [`${year}-01-01`, `${year}-12-31`]);
  }
  if (group) q.where('category_group', group);
  if (category) q.where('category', category);
  if (source) q.where('source', source);
  if (search) q.whereRaw('LOWER(description) LIKE ?', [`%${String(search).toLowerCase()}%`]);
  return q;
}

export { isoDate, monthRange, parseMonths, applyFilters };
