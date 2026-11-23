// Rent payments from finance transactions → rent_collections.
//
// A transaction is a rent payment when it is money in (amount > 0) and its
// category is mapped to a property with role 'income' in property_category_map
// ("1205 Rent" → 1205-1207 NE 117th St). Its unit and lease are found with the
// Import Rent page's rules (lib/rentMatch.js), in this order:
//   1. the property has one rentable unit                    → that unit
//   2. the tenant's name in the description (score ≥ 50)      → their unit
//   3. the category names a unit ("1207 Rent" → unit 1207)   → that unit
//   4. the amount equals exactly one unit's lease rent (±$1)  → that unit
// otherwise the payment waits in "Rent needs a unit" for you to pick one.
//
// Rows written here have source = 'finance_upload' and transaction_id set (one
// row per transaction, enforced by a unique index), so syncing is idempotent.
// Rows entered by hand ('manual') or by the old CSV import ('csv_import') are
// never changed: a transaction that matches one of them counts as already
// recorded and creates nothing — same unit, paid date and whole-dollar amount,
// or (on the matched unit) the same rent month and amount (±$1) paid within 7
// days. A second payment in a month (e.g. a Section 8 portion) still records.
//
// When a transaction stops being rent (recategorized, or its category is
// unmapped) its finance_upload row is deleted. Deleting the transaction itself
// sets transaction_id to NULL (FK ON DELETE SET NULL); if the same bank row is
// uploaded again, the orphaned row is linked back instead of duplicated.
import { bestTenantByName, isoOf, paymentFlags } from './rentMatch.js';

const SOURCE = 'finance_upload';
const nowText = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const truthy = (v) => v === true || v === 't' || v === 'true' || v === 1 || v === '1';

/** Everything matching needs, loaded once per sync. */
export async function loadRentContext(knex) {
  const [maps, props, units, tenants, leases] = await Promise.all([
    knex('property_category_map').where({ role: 'income' }).whereNotNull('property_id').select('category', 'property_id'),
    knex('owned_properties').select('id', 'address'),
    knex('units').select('*'),
    knex('tenants').select('*'),
    knex('leases').select('*'),
  ]);
  const rentCats = new Map(maps.map((m) => [m.category, Number(m.property_id)]));
  const address = new Map(props.map((p) => [Number(p.id), p.address]));
  const unitsByProperty = new Map();
  const unitById = new Map();
  for (const u of units) {
    const unit = { id: Number(u.id), property_id: Number(u.property_id), unit_label: u.unit_label, owner: truthy(u.is_owner_unit) };
    unitById.set(unit.id, unit);
    if (unit.owner) continue; // the unit you live in collects no rent
    if (!unitsByProperty.has(unit.property_id)) unitsByProperty.set(unit.property_id, []);
    unitsByProperty.get(unit.property_id).push(unit);
  }
  const leasesByUnit = new Map();
  for (const l of leases) {
    const k = Number(l.unit_id);
    if (!leasesByUnit.has(k)) leasesByUnit.set(k, []);
    leasesByUnit.get(k).push({ ...l, id: Number(l.id), unit_id: k, tenant_id: Number(l.tenant_id) });
  }
  for (const list of leasesByUnit.values()) list.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  const tenantById = new Map(tenants.map((t) => [Number(t.id), { ...t, id: Number(t.id), unit_id: Number(t.unit_id) }]));
  return { rentCats, address, unitsByProperty, unitById, leasesByUnit, tenantById };
}

/** The unit's lease in force on `date`, else its latest lease (as Import Rent did), else null. */
export function leaseOn(ctx, unitId, date) {
  const list = ctx.leasesByUnit.get(unitId) || [];
  const d = isoOf(date);
  return list.find((l) => isoOf(l.start_date) <= d && d <= isoOf(l.end_date)) || list[0] || null;
}

/** Property id when `t` is a rent payment, else null. */
export function rentPropertyOf(ctx, t) {
  if (!(Number(t.amount) > 0)) return null;
  return ctx.rentCats.get(t.category) ?? null;
}

/**
 * Unit + lease for a rent payment.
 * → { unit_id, lease, method: 'single_unit'|'name'|'category'|'amount', score? } or { unit_id: null, reason }
 */
export function matchRentTransaction(ctx, t) {
  const propertyId = rentPropertyOf(ctx, t);
  if (propertyId == null) return { unit_id: null, reason: 'Not a rent payment' };
  const units = ctx.unitsByProperty.get(propertyId) || [];
  const date = ymd(t.date);
  if (!units.length) return { unit_id: null, reason: 'This property has no units yet' };
  if (units.length === 1) return { unit_id: units[0].id, lease: leaseOn(ctx, units[0].id, date), method: 'single_unit' };

  // Tenants of this property: everyone living there now, plus anyone whose
  // lease covered the payment date (so older payments still find a tenant
  // who has since moved out).
  const unitIds = new Set(units.map((u) => u.id));
  const candidates = new Map();
  for (const tn of ctx.tenantById.values()) {
    if (unitIds.has(tn.unit_id) && truthy(tn.is_active)) candidates.set(tn.id, tn);
  }
  for (const u of units) {
    const l = leaseOn(ctx, u.id, date);
    const tn = l && ctx.tenantById.get(l.tenant_id);
    if (tn && isoOf(l.start_date) <= date && date <= isoOf(l.end_date)) candidates.set(tn.id, { ...tn, unit_id: u.id });
  }
  const { tenant, score, name } = bestTenantByName(t.description, [...candidates.values()]);
  if (tenant) return { unit_id: tenant.unit_id, lease: leaseOn(ctx, tenant.unit_id, date), method: 'name', score };

  // "1205 Rent" on a property with units 1205 and 1207 names the unit.
  const num = String(t.category).match(/^(\d+)\b/)?.[1];
  const byLabel = num ? units.filter((u) => String(u.unit_label).trim() === num) : [];
  if (byLabel.length === 1) return { unit_id: byLabel[0].id, lease: leaseOn(ctx, byLabel[0].id, date), method: 'category' };

  const amount = Number(t.amount);
  const byAmount = units.filter((u) => {
    const l = leaseOn(ctx, u.id, date);
    return l && Math.abs(Number(l.rent_amount) - amount) <= 1;
  });
  if (byAmount.length === 1) return { unit_id: byAmount[0].id, lease: leaseOn(ctx, byAmount[0].id, date), method: 'amount' };

  const why = name ? `No tenant named like “${name}”` : 'No tenant name in the description';
  return { unit_id: null, reason: byAmount.length > 1 ? `${why}, and ${byAmount.length} units have this rent` : `${why}, and no lease rent equals this amount` };
}

/** The rent_collections columns for a payment on a unit/lease. */
export function rentRowFor(t, unitId, lease, extra = {}) {
  const amount = Number(t.amount);
  const flags = paymentFlags(ymd(t.date), amount, lease);
  const amountPaid = Math.round(amount);
  const amountDue = Math.round(lease?.rent_amount ?? amount);
  const isPartial = amountPaid < amountDue;
  const method = extra.method ? { single_unit: 'only unit', name: 'tenant name', category: 'category', amount: 'rent amount', manual: 'picked by you' }[extra.method] : null;
  return {
    unit_id: unitId,
    lease_id: lease?.id ?? null,
    due_date: flags.dueDate,
    amount_due: amountDue,
    paid_date: ymd(t.date),
    amount_paid: amountPaid,
    is_partial: isPartial,
    is_late: flags.isLate,
    late_fee_applicable: flags.lateFeeApplicable,
    payment_status: isPartial ? 'partial' : 'paid',
    source: SOURCE,
    import_batch_id: t.upload_id != null ? `upload-${t.upload_id}` : null,
    notes: [flags.note, method && `Matched by ${method}`].filter(Boolean).join(' · ') || null,
    transaction_id: Number(t.id),
  };
}

async function existingRows(knex) {
  const rows = await knex('rent_collections').select('*');
  const byTxn = new Map();
  const byKey = new Map(); // unit|paid date|amount → paid rows without a transaction
  const byUnit = new Map(); // unit → your own paid rows (manual / csv_import), for the near-match below
  for (const r of rows) {
    if (r.transaction_id != null) {
      byTxn.set(Number(r.transaction_id), r);
      continue;
    }
    if (r.paid_date == null || r.amount_paid == null) continue;
    const k = `${r.unit_id}|${isoOf(r.paid_date)}|${r.amount_paid}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
    if (r.source !== SOURCE) {
      const u = Number(r.unit_id);
      if (!byUnit.has(u)) byUnit.set(u, []);
      byUnit.get(u).push(r);
    }
  }
  return { byTxn, byKey, byUnit, used: new Set() };
}

const dayNum = (d) => {
  const p = isoOf(d).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000;
};

/** A paid row without a transaction for exactly this payment (same unit, paid date, whole dollars). */
function exactMatch(ctx, rows, t, propertyId) {
  for (const u of ctx.unitsByProperty.get(propertyId) || []) {
    const hit = (rows.byKey.get(`${u.id}|${ymd(t.date)}|${Math.round(Number(t.amount))}`) || []).find((r) => !rows.used.has(r.id));
    if (hit) return hit;
  }
  return null;
}

/**
 * The same payment entered by hand: on the matched unit, for the same rent
 * month, the same amount (±$1), paid within 7 days of the bank date.
 */
function nearMatch(rows, t, unitId, dueDate) {
  return (rows.byUnit.get(unitId) || []).find(
    (r) =>
      !rows.used.has(r.id) &&
      isoOf(r.due_date) === dueDate &&
      Math.abs(Number(r.amount_paid) - Number(t.amount)) <= 1 &&
      Math.abs(dayNum(r.paid_date) - dayNum(t.date)) <= 7,
  );
}

const SAME_FIELDS = ['unit_id', 'lease_id', 'due_date', 'amount_due', 'paid_date', 'amount_paid', 'is_partial', 'is_late', 'late_fee_applicable', 'payment_status', 'notes'];
const differs = (row, existing) =>
  SAME_FIELDS.some((k) => {
    const a = row[k];
    const b = existing[k];
    if (typeof a === 'boolean') return a !== truthy(b);
    return String(a ?? '') !== String(b ?? '');
  });

const describe = (ctx, t, reason) => ({
  id: Number(t.id),
  date: ymd(t.date),
  description: t.description,
  amount: Number(t.amount),
  category: t.category,
  property_id: ctx.rentCats.get(t.category) ?? null,
  property: ctx.address.get(ctx.rentCats.get(t.category)) ?? null,
  reason,
});

/**
 * Create, update or remove rent_collections rows for these transactions
 * (every transaction when ids is null — that is the backfill).
 * → { created, updated, relinked, removed, already_recorded, unmatched: [...], changes: [...] }
 */
export async function syncRent(knex, ids = null, { dryRun = false } = {}) {
  const out = { dry_run: dryRun, scanned: 0, created: 0, updated: 0, relinked: 0, removed: 0, already_recorded: 0, unmatched: [], changes: [] };
  if (Array.isArray(ids) && !ids.length) return out;
  if (!(await knex.schema.hasColumn('rent_collections', 'transaction_id'))) return out;
  const ctx = await loadRentContext(knex);
  const q = knex('transactions').select('id', 'date', 'description', 'amount', 'category', 'upload_id').orderBy('date').orderBy('id');
  if (Array.isArray(ids)) q.whereIn('id', ids);
  else q.where('amount', '>', 0).whereIn('category', [...ctx.rentCats.keys()]);
  const txns = await q;
  const rows = await existingRows(knex);
  // Rows linked to transactions that are no longer rent, found from the rent side too
  // (the backfill also cleans up rows whose transaction left a rent category).
  if (!Array.isArray(ids)) {
    const linked = [...rows.byTxn.keys()];
    const still = new Set(txns.map((t) => Number(t.id)));
    const gone = linked.filter((id) => !still.has(id) && rows.byTxn.get(id).source === SOURCE);
    if (gone.length) txns.push(...(await knex('transactions').whereIn('id', gone).select('id', 'date', 'description', 'amount', 'category', 'upload_id')));
  }
  out.scanned = txns.length;

  const writes = [];
  for (const t of txns) {
    const id = Number(t.id);
    const linked = rows.byTxn.get(id);
    const propertyId = rentPropertyOf(ctx, t);
    if (propertyId == null) {
      if (linked && linked.source === SOURCE) {
        out.removed += 1;
        out.changes.push({ action: 'remove', ...describe(ctx, t, 'No longer a rent payment') });
        writes.push(() => knex('rent_collections').where({ id: linked.id }).del());
      }
      continue;
    }
    if (linked) {
      if (linked.source !== SOURCE) continue; // never rewrite your own entries
      const manual = truthy(linked.unit_set_manually);
      const unitOk = manual && ctx.unitsByProperty.get(propertyId)?.some((u) => u.id === Number(linked.unit_id));
      const m = unitOk ? { unit_id: Number(linked.unit_id), lease: leaseOn(ctx, Number(linked.unit_id), ymd(t.date)), method: 'manual' } : matchRentTransaction(ctx, t);
      if (!m.unit_id) {
        out.removed += 1;
        out.unmatched.push(describe(ctx, t, m.reason));
        out.changes.push({ action: 'remove', ...describe(ctx, t, m.reason) });
        writes.push(() => knex('rent_collections').where({ id: linked.id }).del());
        continue;
      }
      const row = rentRowFor(t, m.unit_id, m.lease, { method: m.method });
      if (differs(row, linked)) {
        out.updated += 1;
        out.changes.push({ action: 'update', ...describe(ctx, t, null) });
        writes.push(() => knex('rent_collections').where({ id: linked.id }).update({ ...row, updated_at: nowText() }));
      }
      continue;
    }
    const legacy = exactMatch(ctx, rows, t, propertyId);
    if (legacy) {
      rows.used.add(legacy.id);
      if (legacy.source === SOURCE) {
        out.relinked += 1;
        out.changes.push({ action: 'relink', rent_id: legacy.id, ...describe(ctx, t, 'Same payment uploaded again') });
        writes.push(() => knex('rent_collections').where({ id: legacy.id }).update({ transaction_id: id }));
      } else {
        out.already_recorded += 1;
      }
      continue;
    }
    const m = matchRentTransaction(ctx, t);
    if (!m.unit_id) {
      out.unmatched.push(describe(ctx, t, m.reason));
      continue;
    }
    const near = nearMatch(rows, t, m.unit_id, paymentFlags(ymd(t.date), Number(t.amount), m.lease).dueDate);
    if (near) {
      rows.used.add(near.id);
      out.already_recorded += 1;
      continue;
    }
    const row = rentRowFor(t, m.unit_id, m.lease, { method: m.method });
    out.created += 1;
    const unit = ctx.unitById.get(m.unit_id);
    out.changes.push({ action: 'create', unit: unit?.unit_label ?? null, due_date: row.due_date, method: m.method, ...describe(ctx, t, null) });
    writes.push(() => knex('rent_collections').insert({ ...row, unit_set_manually: false }));
  }
  if (!dryRun) for (const w of writes) await w();
  return out;
}

/** Rent payments waiting for a unit (computed fresh; nothing is stored for them). */
export async function rentNeedingUnit(knex) {
  const r = await syncRent(knex, null, { dryRun: true });
  return r.unmatched;
}

/** Units (with their current lease) a rent payment could belong to — for the picker. */
export async function rentUnitOptions(knex, transactionId) {
  const ctx = await loadRentContext(knex);
  const t = await knex('transactions').where({ id: Number(transactionId) }).first();
  if (!t) throw Object.assign(new Error(`Transaction ${transactionId} not found`), { status: 404 });
  const propertyId = rentPropertyOf(ctx, t);
  if (propertyId == null) throw Object.assign(new Error('That transaction is not a rent payment'), { status: 400 });
  return (ctx.unitsByProperty.get(propertyId) || []).map((u) => {
    const l = leaseOn(ctx, u.id, ymd(t.date));
    const tn = l && ctx.tenantById.get(l.tenant_id);
    return { unit_id: u.id, unit_label: u.unit_label, lease_id: l?.id ?? null, rent_amount: l ? Number(l.rent_amount) : null, tenant: tn ? `${tn.first_name} ${tn.last_name}` : null };
  });
}

/** Record a rent payment on the unit you picked (and lease, default: the one in force). */
export async function assignRentUnit(knex, transactionId, body = {}) {
  const ctx = await loadRentContext(knex);
  const t = await knex('transactions').where({ id: Number(transactionId) }).first();
  if (!t) throw Object.assign(new Error(`Transaction ${transactionId} not found`), { status: 404 });
  const propertyId = rentPropertyOf(ctx, t);
  if (propertyId == null) throw Object.assign(new Error('That transaction is not a rent payment'), { status: 400 });
  const unitId = Number(body.unit_id);
  if (!ctx.unitsByProperty.get(propertyId)?.some((u) => u.id === unitId)) {
    throw Object.assign(new Error("That unit isn't part of this payment's property"), { status: 400 });
  }
  let lease = leaseOn(ctx, unitId, ymd(t.date));
  if (body.lease_id != null && body.lease_id !== '') {
    lease = (ctx.leasesByUnit.get(unitId) || []).find((l) => l.id === Number(body.lease_id));
    if (!lease) throw Object.assign(new Error("That lease isn't on this unit"), { status: 400 });
  }
  const row = { ...rentRowFor(t, unitId, lease, { method: 'manual' }), unit_set_manually: true };
  const existing = await knex('rent_collections').where({ transaction_id: Number(t.id) }).first();
  if (existing) {
    if (existing.source !== SOURCE) throw Object.assign(new Error('This payment is already recorded by hand'), { status: 409 });
    await knex('rent_collections').where({ id: existing.id }).update({ ...row, updated_at: nowText() });
    return { success: true, rent_collection_id: existing.id };
  }
  const [ins] = await knex('rent_collections').insert(row).returning('id');
  return { success: true, rent_collection_id: ins.id ?? ins };
}

/** Run after any category change; a failure is logged, never fails the change. */
export async function syncRentQuietly(knex, ids) {
  try {
    return await syncRent(knex, ids);
  } catch (e) {
    console.error('rent sync failed', e);
    return null;
  }
}

/**
 * Re-check only the rows already created from transactions (after category
 * renames/merges or mapping changes): updates them, removes the ones that are
 * no longer rent. Never creates rows for past transactions — that's the backfill.
 */
export async function refreshLinkedRent(knex) {
  try {
    if (!(await knex.schema.hasColumn('rent_collections', 'transaction_id'))) return null;
    const ids = (await knex('rent_collections').where({ source: SOURCE }).whereNotNull('transaction_id').select('transaction_id')).map((r) => Number(r.transaction_id));
    return await syncRent(knex, ids);
  } catch (e) {
    console.error('rent refresh failed', e);
    return null;
  }
}
