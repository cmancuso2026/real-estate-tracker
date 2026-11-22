// Attribution suggestions: a property (and maybe a project or unit) to pre-fill
// for a transaction. Suggestions are never saved automatically — the UI pre-fills
// them and you confirm. Sources, highest priority first:
//
//   1. rule     — an enabled merchant rule with a property (Phase 7 adds rules;
//                 until then this step finds nothing)
//   2. vendor   — the description names a vendor → that vendor's open project
//                 (most recent), else the property of its most recent project
//   3. address  — the description contains a street number of an owned property
//                 ("1205", "1821"), or a short one with its direction ("20 NW");
//                 a number that is also a unit label suggests that unit
//   4. default  — the category's default_property_id (category_settings)
//   5. history  — the property you last picked for the same merchant (property only)
//
// buildSuggestionContext() loads everything once, so the queue can score many
// rows with one set of queries.
import { merchantKey } from './merchantKey.js';

const OPEN = new Set(['received', 'open']);
const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Street numbers an address answers to: '1205-1207 NE 117th St' → 1205, 1207 (+ direction NE). */
export function addressKeys(address, unitLabels = []) {
  const m = String(address || '').trim().match(/^(\d+)(?:\s*[-–&/]\s*(\d+))?\s+(\S+)/);
  const nums = new Set();
  let dir = null;
  if (m) {
    nums.add(m[1]);
    if (m[2]) nums.add(m[2]);
    if (DIRS.has(m[3].toUpperCase())) dir = m[3].toUpperCase();
  }
  for (const u of unitLabels) if (/^\d+$/.test(String(u))) nums.add(String(u));
  return { nums: [...nums], dir };
}

/** Does `desc` mention street number `n`? Short numbers need the direction ("20 NW"). */
export function mentionsNumber(desc, n, dir) {
  const d = norm(desc);
  if (n.length >= 3) return new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(d);
  if (!dir) return false;
  return new RegExp(`(^|[^0-9])${n} ${dir}( |$)`).test(d);
}

/** Does `desc` name `vendor`? Whole vendor name, or its first two words. */
export function mentionsVendor(desc, vendorName) {
  const d = ` ${norm(desc)} `;
  const v = norm(vendorName);
  if (v.length < 4) return false;
  if (d.includes(` ${v} `) || d.includes(` ${v}`)) return true;
  const words = v.split(' ').filter((w) => w.length >= 3);
  return words.length >= 2 && d.includes(` ${words[0]} ${words[1]}`);
}

export async function buildSuggestionContext(knex) {
  const [properties, units, vendors, workOrders, quotes, settings, history] = await Promise.all([
    knex('owned_properties').select('id', 'address').orderBy('id'),
    knex('units').select('id', 'property_id', 'unit_label'),
    knex('vendors').select('id', 'name'),
    knex('work_orders').select('id', 'property_id', 'vendor_id', 'project_name', 'description', 'status', 'created_at', 'updated_at'),
    knex('project_quotes').select('work_order_id', 'vendor_id'),
    knex('category_settings').select('category', 'default_property_id'),
    knex('attribution_overrides as o')
      .whereNotNull('o.property_id')
      .select('o.description', 'o.property_id', 'o.work_order_id', 'o.unit_id', 'o.updated_at')
      .orderBy('o.updated_at', 'desc'),
  ]);
  const unitsByProp = new Map();
  for (const u of units) {
    if (!unitsByProp.has(u.property_id)) unitsByProp.set(u.property_id, []);
    unitsByProp.get(u.property_id).push(u);
  }
  const addr = properties.map((p) => {
    const pu = unitsByProp.get(p.id) || [];
    return { property: p, units: pu, ...addressKeys(p.address, pu.map((u) => u.unit_label)) };
  });
  // vendor id → its projects (via work_orders.vendor_id or a quote), newest activity first
  const woById = new Map(workOrders.map((w) => [w.id, w]));
  const vendorProjects = new Map();
  const link = (vendorId, wo) => {
    if (!vendorId || !wo) return;
    if (!vendorProjects.has(vendorId)) vendorProjects.set(vendorId, new Map());
    vendorProjects.get(vendorId).set(wo.id, wo);
  };
  for (const w of workOrders) link(w.vendor_id, w);
  for (const q of quotes) link(q.vendor_id, woById.get(q.work_order_id));
  const activity = (w) => String(w.updated_at || w.created_at || '');
  const vendorList = vendors.map((v) => ({
    vendor: v,
    projects: [...(vendorProjects.get(v.id)?.values() || [])].sort((a, b) => activity(b).localeCompare(activity(a)) || b.id - a.id),
  }));
  const defaults = new Map(settings.filter((s) => s.default_property_id != null).map((s) => [s.category, Number(s.default_property_id)]));
  const lastByMerchant = new Map();
  for (const h of history) {
    const k = merchantKey(h.description || '');
    if (k && !lastByMerchant.has(k)) lastByMerchant.set(k, h); // newest first
  }
  return { properties, addr, vendorList, defaults, lastByMerchant, rules: [] };
}

const projectLabel = (w) => w.project_name || w.description || `Project #${w.id}`;

/**
 * Ordered suggestions for one transaction ({ description, category }).
 * Each: { property_id, unit_id, work_order_id, source, reason }. One entry per
 * property (the highest-priority source wins).
 */
export function suggestFor(ctx, txn) {
  const out = [];
  const seen = new Set();
  const push = (s) => {
    if (!s.property_id || seen.has(s.property_id)) return;
    seen.add(s.property_id);
    out.push({ unit_id: null, work_order_id: null, ...s });
  };
  const addrOf = (id) => ctx.properties.find((p) => p.id === id)?.address || `property ${id}`;

  // 1. merchant rules (Phase 7)
  for (const r of ctx.rules) {
    if (r.property_id && r.matches(txn.description)) {
      push({ property_id: r.property_id, work_order_id: r.work_order_id || null, source: 'rule', reason: `Merchant rule “${r.pattern}”` });
    }
  }
  // 2. vendor
  for (const { vendor, projects } of ctx.vendorList) {
    if (!projects.length || !mentionsVendor(txn.description, vendor.name)) continue;
    const open = projects.find((w) => OPEN.has(w.status));
    const pick = open || projects[0];
    push({
      property_id: pick.property_id,
      work_order_id: open ? open.id : null,
      source: 'vendor',
      reason: open ? `Vendor ${vendor.name}: open project “${projectLabel(open)}”` : `Vendor ${vendor.name}: last worked at ${addrOf(pick.property_id)}`,
    });
  }
  // 3. street number / unit
  for (const a of ctx.addr) {
    const hit = a.nums.find((n) => mentionsNumber(txn.description, n, a.dir));
    if (!hit) continue;
    const unit = a.units.find((u) => String(u.unit_label) === hit);
    push({
      property_id: a.property.id,
      unit_id: unit ? unit.id : null,
      source: 'address',
      reason: `Description mentions ${hit}${a.dir && hit.length < 3 ? ' ' + a.dir : ''} (${a.property.address})`,
    });
  }
  // 4. category default
  const def = ctx.defaults.get(txn.category);
  if (def) push({ property_id: def, source: 'default', reason: `Default property for ${txn.category}` });
  // 5. your last pick for this merchant
  const k = merchantKey(txn.description || '');
  const last = k && ctx.lastByMerchant.get(k);
  if (last) {
    // Property only: a project or unit picked for one receipt rarely applies to
    // every later purchase from the same merchant.
    push({
      property_id: Number(last.property_id),
      source: 'history',
      reason: `You last assigned ${k} to ${addrOf(Number(last.property_id))}`,
    });
  }
  return out;
}
