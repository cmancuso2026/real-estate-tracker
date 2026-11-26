// The combined Overview at "/": personal finance and real estate side by side,
// plus actual cash flow per property. One call gathers everything for a month.
//
// Definitions (match the property pages):
//   rental unit      a unit not marked as owner-occupied (units.is_owner_unit)
//   occupied         a rental unit with an active tenant
//   scheduled rent   the latest lease's monthly rent for each occupied unit
//   rent this month  rent_collections rows due in the month (rental units)
//   expiring soon    lease end / policy expiration within the next 60 days
//   finance figures  the shared definition in lib/metrics.js (same as /finance and
//                    /api/finance/summary): transfers between your accounts left out,
//                    refunds netted against spending
import { rentForMonth, sumRent } from '../lib/rentMonth.js';
import { mergedTaxonomy } from '../lib/categoryStore.js';
import { unattributedCount } from '../lib/attribution.js';
import { propertyCashFlow } from '../lib/cashflow.js';
import { DEFINITIONS, financeTotals, loadMetricsContext, spendingByGroup } from '../lib/metrics.js';
import { withAllocations } from '../lib/allocations.js';
import { cashSummary } from '../lib/balances.js';
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

/** The four numbers the landing page shows, from the shared definition (lib/metrics.js). */
function totals(rows, ctx) {
  const t = financeTotals(rows, ctx);
  return { income: t.income, spending: t.spending, cash_flow: t.cash_flow, count: t.count };
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
      .select('id', 'date', 'amount', 'category'),
    mergedTaxonomy(knex),
    knex('upload_log').select('id', 'filename', 'source', 'row_count', 'new_rows', 'skipped', 'uploaded_at').orderBy('id', 'desc'),
    knex('transactions').select('source').max({ last: 'date' }).count({ n: '*' }).groupBy('source'),
    knex('owned_properties').select('id', 'address').orderBy('id'),
    knex('units').select('id', 'property_id', 'unit_label', 'is_owner_unit'),
    knex('tenants').where({ is_active: true }).select('id', 'unit_id', 'first_name', 'last_name'),
    knex('leases').select('id', 'unit_id', 'tenant_id', 'start_date', 'end_date', 'rent_amount'),
    knex('rent_collections').whereBetween('due_date', [start, end]).select('unit_id', 'due_date', 'amount_due', 'amount_paid'),
    knex('insurance_policies').select('id', 'property_id', 'carrier', 'policy_type', 'expiration_date'),
    knex('property_category_map').select('category', 'property_id', 'role', 'confirmed'),
    unattributedCount(knex),
  ]);

  // ── Personal finance ────────────────────────────────────────────────────
  const mctx = await loadMetricsContext(knex);
  const monthRows = ytdRows.filter((t) => isoDate(t.date) >= start);
  const lastBySource = new Map();
  for (const u of uploads) if (!lastBySource.has(u.source)) lastBySource.set(u.source, u);
  const finance = {
    month: totals(monthRows, mctx),
    ytd: totals(ytdRows, mctx),
    definitions: DEFINITIONS,
    cash: await cashSummary(knex, { asOf: end }),
    top_groups: { month: spendingByGroup(monthRows, mctx, 5), ytd: spendingByGroup(ytdRows, mctx, 5) },
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
  // Rent this month, per unit (lib/rentMonth.js): due from the lease in force,
  // collected = every payment that month (a split payment is several rows).
  const rentByUnit = rentForMonth({
    unitIds: rental.map((u) => u.id),
    leases,
    rows: rent,
    start,
    end,
    occupied: new Set(occupied.map((u) => u.id)),
  });
  const { due, collected, outstanding } = sumRent(rentByUnit);
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

  // Cash flow per property (rent, PITI, expenses) for the month and YTD.
  const flow = propertyCashFlow(await withAllocations(knex, ytdRows), mappings, { month });
  // PITI this month: the PITI categories mapped to each property (negative
  // amounts = paid), shown as a positive total with each property's part.
  const pitiByProperty = props.map((p) => ({ property_id: p.id, address: p.address, amount: r2(-(flow.get(p.id)?.month.piti ?? 0)) }));
  const pitiMonth = {
    total: r2(pitiByProperty.reduce((s, x) => s + x.amount, 0)),
    ytd: r2(-props.reduce((s, p) => s + (flow.get(p.id)?.ytd.piti ?? 0), 0)),
    by_property: pitiByProperty,
  };

  const realEstate = {
    properties: props.length,
    units: units.length,
    rental_units: rental.length,
    occupied_units: occupied.length,
    occupancy: rental.length ? r2(occupied.length / rental.length) : null,
    rent_roll: rentRoll,
    rent_this_month: { due, collected, outstanding },
    piti_this_month: pitiMonth,
    expiring_leases: expiringLeases,
    expiring_policies: expiringPolicies,
  };

  // ── Per property ────────────────────────────────────────────────────────
  const zero = { rent: 0, piti: 0, expenses: 0, net: 0, count: 0 };
  const propertiesTable = props.map((p) => {
    const pu = units.filter((u) => u.property_id === p.id);
    const pr = pu.filter((u) => !u.is_owner_unit);
    const po = pr.filter((u) => activeTenantByUnit.has(u.id));
    const prRent = sumRent(rentByUnit, pr.map((u) => u.id));
    const f = flow.get(p.id) || { month: zero, ytd: zero };
    return {
      id: p.id,
      address: p.address,
      units: pu.length,
      rental_units: pr.length,
      occupied_units: po.length,
      occupancy: pr.length ? r2(po.length / pr.length) : null,
      scheduled_rent: po.reduce((s, u) => s + Number(latestLease.get(u.id)?.rent_amount || 0), 0),
      rent_collected: prRent.collected,
      rent_due: prRent.due,
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
