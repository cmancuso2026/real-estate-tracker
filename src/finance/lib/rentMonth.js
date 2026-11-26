// One rule for "rent this month", used by every page that shows it.
//
// rent_collections has one row per payment (a split payment — e.g. tenant and
// Section 8, or two transfers — is two rows, each carrying the full rent as
// amount_due). So per unit and month:
//   due       = the rent of the lease in force that month (the rent roll),
//               else the largest amount_due on its rows, else 0
//   collected = the sum of every payment that month
//   status    = paid (collected ≥ due) · partial · unpaid (rows, nothing paid)
//               · no_record (no row at all — the rent is still due)
// Owner-occupied units are left out by the caller.

const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

/** The lease covering any part of [start, end] (latest start wins), else null. */
export function leaseForMonth(leases, start, end) {
  return (
    [...leases]
      .filter((l) => ymd(l.start_date) <= end && ymd(l.end_date) >= start)
      .sort((a, b) => ymd(b.start_date).localeCompare(ymd(a.start_date)))[0] ?? null
  );
}

/**
 * Rent per unit for one month.
 * @param {{ unitIds: number[], leases: object[], rows: object[], start: string, end: string, occupied?: Set<number> }} p
 *   rows: rent_collections rows (any months; only [start, end] count).
 *   occupied: units with a tenant — a unit with no tenant and no payment owes nothing.
 * @returns {Map<number, { due: number, collected: number, outstanding: number, payments: number, status: string }>}
 */
export function rentForMonth({ unitIds, leases, rows, start, end, occupied = null }) {
  const out = new Map();
  for (const id of unitIds) {
    const unitRows = rows.filter((r) => Number(r.unit_id) === id && ymd(r.due_date) >= start && ymd(r.due_date) <= end);
    const lease = leaseForMonth(leases.filter((l) => Number(l.unit_id) === id), start, end);
    const rowDue = unitRows.reduce((m, r) => Math.max(m, Number(r.amount_due) || 0), 0);
    const vacant = occupied && !occupied.has(id) && !unitRows.length;
    const due = vacant ? 0 : Number(lease?.rent_amount ?? 0) || rowDue;
    const collected = unitRows.reduce((s, r) => s + (Number(r.amount_paid) || 0), 0);
    const status = !unitRows.length ? (due > 0 ? 'no_record' : 'none') : collected <= 0 ? 'unpaid' : collected >= due ? 'paid' : 'partial';
    out.set(id, { due, collected, outstanding: Math.max(0, due - collected), payments: unitRows.length, status });
  }
  return out;
}

/** Totals over units. */
export function sumRent(map, ids = [...map.keys()]) {
  let due = 0;
  let collected = 0;
  let outstanding = 0;
  for (const id of ids) {
    const r = map.get(id);
    if (!r) continue;
    due += r.due;
    collected += r.collected;
    outstanding += r.outstanding;
  }
  return { due, collected, outstanding };
}
