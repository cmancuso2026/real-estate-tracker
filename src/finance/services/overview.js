// The combined Overview at "/": personal finance and real estate side by side,
// plus actual cash flow per property. One call gathers everything for a month.
//
// Definitions (match the property pages):
//   rental unit      a unit not marked as owner-occupied (units.is_owner_unit)
//   occupied         a rental unit with an active tenant
//   scheduled rent   the latest lease's monthly rent for each occupied unit
//   rent this month  rent_collections rows due in the month (rental units)
//   expiring soon    lease end / policy expiration within the next 60 days
//   finance figures  as on /finance: income = positive amounts, spending =
//                    negative amounts, cash flow = income − spending
import { mergedTaxonomy } from '../lib/categoryStore.js';
import { unattributedCount } from '../lib/attribution.js';
import { propertyCashFlow } from '../lib/cashflow.js';
import { isoDate } from './_query.js';

const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const EXPIRING_DAYS = 60;

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}`, ytdStart: `${y}-01-01` };
}

function totals(rows) {
  let income = 0;
  let spending = 0;
  for (const t of rows) {
    const a = Number(t.amount);
    if (a > 0) income += a;
    else spending += -a;
  }
  return { income: r2(income), spending: r2(spending), cash_flow: r2(income - spending), count: rows.length };
}

function topGroups(rows, catToGroup, n = 5) {
  const by = {};
  for (const t of rows) {
    const a = Number(t.amount);
    if (a >= 0) continue;
    const g = catToGroup[t.category] || 'Other';
    by[g] = (by[g] || 0) - a;
  }
  return Object.entries(by)
    .map(([group, spending]) => ({ group, spending: r2(spending) }))
    .sort((a, b) => b.spending - a.spending)
    .slice(0, n);
}

/**
 * @param {import('knex').Knex} knex
 * @param {{ month?: string, today?: string }} opts  month 'YYYY-MM' (default: this month); today 'YYYY-MM-DD'
 */
export async function getOverview(knex, opts = {}) {
  const now = new Date();
  const today = opts.today || ymd(now);
  const month = /^\d{4}-\d{2}$/.test(opts.month || '') ? String(opts.month) : today.slice(0, 7);
  const { start, end, ytdStart } = monthBounds(month);
  const soonDate = new Date(today + 'T00:00:00');
  soonDate.setDate(soonDate.getDate() + EXPIRING_DAYS);
  const soon = ymd(soonDate);

  const [ytdRows, tax, uploads, sourceSpan, props, units, tenants, leases, rent, policies, mappings, queue] = await Promise.all([
    knex('transactions')
      .whereBetween('date', [ytdStart, end])
      .select('date', 'amount', 'category', 'property_id'),
    mergedTaxonomy(knex),
    knex('upload_log').select('id', 'filename', 'source', 'row_count', 'new_rows', 'skipped', 'uploaded_at').orderBy('id', 'desc'),
    knex('transactions').select('source').max({ last: 'date' }).count({ n: '*' }).groupBy('source'),
    knex('owned_properties').select('id', 'address').orderBy('id'),
    knex('units').select('id', 'property_id', 'unit_label', 'is_owner_unit'),
    knex('tenants').where({ is_active: true }).select('id', 'unit_id', 'first_name', 'last_name'),
    knex('leases').select('id', 'unit_id', 'tenant_id', 'start_date', 'end_date', 'rent_amount'),
    knex('rent_collections').whereBetween('due_date', [start, end]).select('unit_id', 'amount_due', 'amount_paid'),
    knex('insurance_policies').select('id', 'property_id', 'carrier', 'policy_type', 'expiration_date'),
    knex('property_category_map').select('category', 'property_id', 'role', 'confirmed'),
    unattributedCount(knex),
  ]);

  // ── Personal finance ────────────────────────────────────────────────────
  const monthRows = ytdRows.filter((t) => isoDate(t.date) >= start);
  const lastBySource = new Map();
  for (const u of uploads) if (!lastBySource.has(u.source)) lastBySource.set(u.source, u);
  const finance = {
    month: totals(monthRows),
    ytd: totals(ytdRows),
    top_groups: { month: topGroups(monthRows, tax.cat_to_group), ytd: topGroups(ytdRows, tax.cat_to_group) },
    latest_uploads: sourceSpan
      .map((s) => {
        const u = lastBySource.get(s.source);
        return {
          source: s.source,
          data_through: isoDate(s.last),
          transactions: Number(s.n),
          last_upload: u ? { filename: u.filename, uploaded_at: u.uploaded_at, new_rows: u.new_rows, skipped: u.skipped } : null,
        };
      })
      .sort((a, b) => String(b.data_through).localeCompare(String(a.data_through))),
  };

  // ── Real estate ─────────────────────────────────────────────────────────
  const unitById = new Map(units.map((u) => [u.id, u]));
  const rental = units.filter((u) => !u.is_owner_unit);
  const activeTenantByUnit = new Map();
  for (const t of tenants) activeTenantByUnit.set(t.unit_id, t);
  const latestLease = new Map(); // unit → latest lease by start date
  for (const l of leases) {
    const cur = latestLease.get(l.unit_id);
    if (!cur || String(l.start_date) > String(cur.start_date)) latestLease.set(l.unit_id, l);
  }
  const occupied = rental.filter((u) => activeTenantByUnit.has(u.id));
  const rentRoll = occupied.reduce((s, u) => s + Number(latestLease.get(u.id)?.rent_amount || 0), 0);
  const rentRows = rent.filter((r) => unitById.get(r.unit_id) && !unitById.get(r.unit_id).is_owner_unit);
  const due = rentRows.reduce((s, r) => s + Number(r.amount_due || 0), 0);
  const collected = rentRows.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  const outstanding = rentRows.reduce((s, r) => s + Math.max(0, Number(r.amount_due || 0) - Number(r.amount_paid || 0)), 0);
  const addressOf = new Map(props.map((p) => [p.id, p.address]));
  const expiringLeases = occupied
    .map((u) => ({ u, l: latestLease.get(u.id), t: activeTenantByUnit.get(u.id) }))
    .filter(({ l }) => l && String(l.end_date) >= today && String(l.end_date) <= soon)
    .map(({ u, l, t }) => ({
      property_id: u.property_id,
      address: addressOf.get(u.property_id),
      unit_label: u.unit_label,
      tenant: `${t.first_name} ${t.last_name}`,
      end_date: String(l.end_date),
      rent_amount: Number(l.rent_amount),
    }))
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  const expiringPolicies = policies
    .filter((p) => String(p.expiration_date) >= today && String(p.expiration_date) <= soon)
    .map((p) => ({
      property_id: p.property_id,
      address: addressOf.get(p.property_id),
      carrier: p.carrier,
      policy_type: p.policy_type,
      expiration_date: String(p.expiration_date),
    }))
    .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));

  const realEstate = {
    properties: props.length,
    units: units.length,
    rental_units: rental.length,
    occupied_units: occupied.length,
    occupancy: rental.length ? r2(occupied.length / rental.length) : null,
    rent_roll: rentRoll,
    rent_this_month: { due, collected, outstanding },
    expiring_leases: expiringLeases,
    expiring_policies: expiringPolicies,
  };

  // ── Per property ────────────────────────────────────────────────────────
  const flow = propertyCashFlow(ytdRows, mappings, { month });
  const zero = { rent: 0, piti: 0, expenses: 0, net: 0, count: 0 };
  const propertiesTable = props.map((p) => {
    const pu = units.filter((u) => u.property_id === p.id);
    const pr = pu.filter((u) => !u.is_owner_unit);
    const po = pr.filter((u) => activeTenantByUnit.has(u.id));
    const ids = new Set(pr.map((u) => u.id));
    const prRent = rentRows.filter((r) => ids.has(r.unit_id));
    const f = flow.get(p.id) || { month: zero, ytd: zero };
    return {
      id: p.id,
      address: p.address,
      units: pu.length,
      rental_units: pr.length,
      occupied_units: po.length,
      occupancy: pr.length ? r2(po.length / pr.length) : null,
      scheduled_rent: po.reduce((s, u) => s + Number(latestLease.get(u.id)?.rent_amount || 0), 0),
      rent_collected: prRent.reduce((s, r) => s + Number(r.amount_paid || 0), 0),
      rent_due: prRent.reduce((s, r) => s + Number(r.amount_due || 0), 0),
      cash_flow: { month: f.month, ytd: f.ytd },
      mapped_categories: mappings.filter((m) => m.property_id === p.id).map((m) => m.category).sort(),
    };
  });

  return {
    month,
    today,
    ytd_start: ytdStart,
    finance,
    real_estate: realEstate,
    attribution: { unattributed: queue },
    properties: propertiesTable,
    mappings: {
      total: mappings.filter((m) => m.property_id != null).length,
      unconfirmed: mappings.filter((m) => m.property_id != null && !m.confirmed).length,
    },
  };
}
