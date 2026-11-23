// Splitting a transaction across properties: transaction_allocations.
//
// A transaction is attributed when its allocations add up exactly to its
// amount. Each allocation names a property (and optionally a unit and a
// project) and carries an amount with the transaction's sign. You enter a
// split either as percentages (must total 100%) or as dollar amounts (must
// total the transaction); amounts are rounded to cents and the last row takes
// whatever rounding leaves over, so the rows always add up to the cent.
//
// A saved split is also stored on attribution_overrides (by dedup_hash, like
// category_overrides) as the values you typed, so it comes back if the same
// bank row is uploaded again. attribution_overrides keeps property_id /
// unit_id / work_order_id for the largest share, which the "you last
// assigned …" suggestion reads.
import { validateAttribution } from './attribution.js';

export const MODES = ['percent', 'amount'];

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const cents = (n) => Math.round(Number(n) * 100);
const fromCents = (c) => Math.round(c) / 100;
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;

/**
 * Turn what you typed into allocation rows for a transaction amount.
 * rows: [{ property_id, unit_id?, work_order_id?, value }] — value is a percent
 * (mode 'percent') or a dollar amount (mode 'amount'; sign optional, the
 * transaction's sign is used). Throws 400 unless they balance exactly.
 * → [{ property_id, unit_id, work_order_id, amount, percent, input_mode }]
 */
export function computeAllocations(txnAmount, mode, rows) {
  if (!MODES.includes(mode)) throw httpError(400, `mode must be one of: ${MODES.join(', ')}`);
  if (!Array.isArray(rows) || rows.length === 0) throw httpError(400, 'rows must be a non-empty array');
  const totalC = cents(txnAmount);
  if (totalC === 0) throw httpError(400, "A $0.00 transaction can't be split");
  const sign = totalC < 0 ? -1 : 1;
  const values = rows.map((r) => Number(r.value));
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) {
    // amounts may be typed with the transaction's sign; zero or wrong-signed rows aren't allowed
    if (!(mode === 'amount' && values.every((v) => Number.isFinite(v) && v !== 0 && Math.sign(v) === sign))) {
      throw httpError(400, 'Every row needs a value above zero');
    }
  }
  const out = [];
  if (mode === 'percent') {
    const pctTotal = values.reduce((s, v) => s + v, 0);
    if (Math.abs(pctTotal - 100) > 0.0005) throw httpError(400, `Percentages must add up to 100% (they add up to ${r3(pctTotal)}%)`);
    let used = 0;
    rows.forEach((r, i) => {
      const last = i === rows.length - 1;
      const c = last ? totalC - used : Math.round((totalC * values[i]) / 100);
      used += c;
      out.push({ ...pick(r), amount: fromCents(c), percent: r3(values[i]), input_mode: 'percent' });
    });
  } else {
    const absC = values.map((v) => Math.abs(cents(v)));
    const sumC = absC.reduce((s, v) => s + v, 0);
    if (sumC !== Math.abs(totalC)) {
      const diff = Math.abs(totalC) - sumC;
      throw httpError(400, `Amounts must add up to ${money(totalC)} (${diff > 0 ? `${money(diff)} unallocated` : `${money(diff)} too much`})`);
    }
    rows.forEach((r, i) => out.push({ ...pick(r), amount: fromCents(sign * absC[i]), percent: null, input_mode: 'amount' }));
  }
  if (out.some((a) => cents(a.amount) === 0)) throw httpError(400, 'A share rounds to $0.00 — remove it or make it larger');
  return out;
}

function pick(r) {
  return {
    property_id: r.property_id == null || r.property_id === '' ? null : Number(r.property_id),
    unit_id: r.unit_id == null || r.unit_id === '' ? null : Number(r.unit_id),
    work_order_id: r.work_order_id == null || r.work_order_id === '' ? null : Number(r.work_order_id),
  };
}

/** Even split: percentages that total exactly 100 (the last row takes the remainder). */
export function evenPercents(n) {
  const base = Math.floor((100 / n) * 1000) / 1000;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? r3(100 - base * (n - 1)) : base));
}

/** Check each row's property exists and its unit / project belong to it. */
export async function validateRows(knex, rows) {
  for (const r of rows) {
    if (r.property_id == null) throw httpError(400, 'Every row needs a property');
    await validateAttribution(knex, r);
  }
}

/** Allocations for these transaction ids → Map(id → rows), ordered as saved. */
export async function allocationsByTxn(knex, ids) {
  const map = new Map();
  const list = [...new Set((ids || []).map(Number))];
  for (let i = 0; i < list.length; i += 5000) {
    const chunk = list.slice(i, i + 5000);
    const rows = await knex('transaction_allocations').whereIn('transaction_id', chunk).orderBy('id');
    for (const a of rows) {
      const k = Number(a.transaction_id);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(normalize(a));
    }
  }
  return map;
}

export function normalize(a) {
  return {
    id: a.id == null ? undefined : Number(a.id),
    property_id: Number(a.property_id),
    unit_id: a.unit_id == null ? null : Number(a.unit_id),
    work_order_id: a.work_order_id == null ? null : Number(a.work_order_id),
    amount: Number(a.amount),
    percent: a.percent == null ? null : Number(a.percent),
    input_mode: a.input_mode || null,
  };
}

/** Attach `allocations` to transaction rows (one query per 5,000 rows). */
export async function withAllocations(knex, rows) {
  const map = await allocationsByTxn(knex, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, allocations: map.get(Number(r.id)) || [] }));
}

/** Sum of allocations in cents and what is left, for a transaction. */
export function allocationStatus(txnAmount, allocs) {
  const total = cents(txnAmount);
  const allocated = (allocs || []).reduce((s, a) => s + cents(a.amount), 0);
  return { allocated: fromCents(allocated), unallocated: fromCents(total - allocated), full: allocated === total && total !== 0 };
}

/** The largest share (first on ties) — what the "last assigned" suggestion remembers. */
export function primaryOf(allocs) {
  return (allocs || []).reduce((best, a) => (!best || Math.abs(a.amount) > Math.abs(best.amount) ? a : best), null);
}

/**
 * Replace a transaction's allocations (rows from computeAllocations; [] clears)
 * and remember the split by dedup_hash for re-uploads. `spec` is what you typed
 * ({ mode, rows: [{ property_id, unit_id, work_order_id, value }] }).
 * Run inside a transaction. `txn` needs id, dedup_hash and description.
 */
export async function saveAllocations(trx, txn, allocs, spec) {
  await trx('transaction_allocations').where({ transaction_id: txn.id }).del();
  if (allocs.length) {
    await trx('transaction_allocations').insert(
      allocs.map((a) => ({
        transaction_id: txn.id,
        property_id: a.property_id,
        unit_id: a.unit_id,
        work_order_id: a.work_order_id,
        amount: a.amount,
        percent: a.percent,
        input_mode: a.input_mode,
      })),
    );
  }
  if (!txn.dedup_hash) return;
  const main = primaryOf(allocs);
  await trx('attribution_overrides')
    .insert({
      dedup_hash: txn.dedup_hash,
      description: txn.description,
      property_id: main ? main.property_id : null,
      unit_id: main ? main.unit_id : null,
      work_order_id: main ? main.work_order_id : null,
      allocations_json: allocs.length ? JSON.stringify(spec) : null,
      updated_at: trx.fn.now(),
    })
    .onConflict('dedup_hash')
    .merge();
}

/** The one-property case: 100% to a property (with optional unit / project). */
export function singleSpec(attr) {
  return { mode: 'percent', rows: [{ property_id: attr.property_id, unit_id: attr.unit_id ?? null, work_order_id: attr.work_order_id ?? null, value: 100 }] };
}

/**
 * Re-create allocations for newly inserted transactions from their saved
 * overrides (upload). `rows`: [{ id, amount, dedup_hash }]. Overrides saved
 * before splits existed (no allocations_json) mean 100% to their property.
 * A saved dollar split that no longer matches the amount is kept as entered
 * and leaves the row partly allocated, so it shows up in Needs Property.
 */
export async function reapplyAllocations(trx, rows) {
  const hashes = rows.map((r) => r.dedup_hash).filter(Boolean);
  if (!hashes.length) return 0;
  const saved = new Map((await trx('attribution_overrides').whereIn('dedup_hash', hashes).select('*')).map((o) => [o.dedup_hash, o]));
  let n = 0;
  for (const r of rows) {
    const o = saved.get(r.dedup_hash);
    if (!o) continue;
    let spec = null;
    if (o.allocations_json) {
      try {
        spec = JSON.parse(o.allocations_json);
      } catch {
        spec = null;
      }
    } else if (o.property_id != null) {
      spec = singleSpec(o);
    }
    if (!spec || !spec.rows?.length) continue;
    let allocs;
    try {
      allocs = computeAllocations(r.amount, spec.mode, spec.rows);
    } catch {
      // keep what fits: the typed dollar amounts, capped to the transaction
      allocs = spec.mode === 'amount' ? partialFromAmounts(r.amount, spec.rows) : [];
    }
    if (!allocs.length) continue;
    await trx('transaction_allocations').insert(allocs.map((a) => ({ transaction_id: r.id, ...a })));
    n += 1;
  }
  return n;
}

function partialFromAmounts(txnAmount, rows) {
  const sign = Number(txnAmount) < 0 ? -1 : 1;
  let left = Math.abs(cents(txnAmount));
  const out = [];
  for (const r of rows) {
    const c = Math.min(Math.abs(cents(r.value)), left);
    if (c <= 0) break;
    left -= c;
    out.push({ ...pick(r), amount: fromCents(sign * c), percent: null, input_mode: 'amount' });
  }
  return out;
}
