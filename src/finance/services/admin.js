// Admin portal service — the logic behind /api/admin/*. Destructive or bulk
// actions take { dry_run: true } first (returns what would change, with row
// counts) and run for real only when called again without it. Every real
// change is written to admin_audit.
import { getCategorySetting, notAllocatedCount, setCategorySetting, unattributedQuery } from '../lib/attribution.js';
import { writeAudit, listAudit } from '../lib/audit.js';
import * as cats from '../lib/categories.js';
import { listPropertyCategoryMap, ROLES } from '../lib/propertyMap.js';
import { buildSuggestionContext, suggestFor } from '../lib/suggest.js';
import { refreshLinkedRent, syncRent } from '../lib/rentSync.js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const dry = (body) => !!(body && (body.dry_run === true || body.dry_run === 'true'));

// ── Categories and groups ───────────────────────────────────────────────────

// GET /api/admin/categories — groups with every category (archived too), its
// usage, its rules (category_settings) and property mapping.
export async function getAdminCategories(knex) {
  const [tax, usage, settings, map] = await Promise.all([
    cats.loadTaxonomy(knex),
    knex('transactions').select('category').count({ n: '*' }).groupBy('category'),
    knex('category_settings').select('*'),
    knex('property_category_map').select('category', 'property_id', 'role', 'confirmed'),
  ]);
  const used = new Map(usage.map((u) => [u.category, Number(u.n)]));
  const set = new Map(settings.map((s) => [s.category, s]));
  const mapped = new Map(map.map((m) => [m.category, m]));
  return {
    groups: tax.groups.map((g) => ({
      id: g.id,
      name: g.name,
      categories: g.categories.map((c) => ({
        id: c.id,
        name: c.name,
        archived: !!c.archived,
        is_builtin: !!c.is_builtin,
        protected: cats.PROTECTED.has(c.name),
        transactions: used.get(c.name) || 0,
        requires_property: !!set.get(c.name)?.requires_property,
        allow_project_tag: set.has(c.name) ? !!set.get(c.name).allow_project_tag : true,
        default_property_id: set.get(c.name)?.default_property_id ?? null,
        mapped_property_id: mapped.get(c.name)?.property_id ?? null,
      })),
    })),
    aliases: Object.fromEntries(tax.aliases),
  };
}

const OPS = {
  add: (k, b, o) => cats.addCategory(k, b, o),
  add_group: (k, b, o) => cats.addGroup(k, b, o),
  rename_group: (k, b, o) => cats.renameGroup(k, b, o),
  rename: (k, b, o) => cats.renameCategory(k, b, o),
  move: (k, b, o) => cats.moveCategory(k, b, o),
  archive: (k, b, o) => cats.archiveCategory(k, { ...b, archived: true }, o),
  unarchive: (k, b, o) => cats.archiveCategory(k, { ...b, archived: false }, o),
  reorder: (k, b) => cats.reorderCategory(k, b),
  merge: (k, b, o) => cats.mergeCategory(k, b, o),
  delete: (k, b, o) => cats.deleteCategory(k, b, o),
};

// POST /api/admin/categories — { op, dry_run?, ...args }.
// ops: add {name, group} · add_group {name} · rename_group {name, new_name} ·
// rename {name, new_name} · move {name, group} · archive/unarchive {name} ·
// reorder {name, direction: up|down} · merge {name, into} · delete {name}
export async function categoryOp(knex, body) {
  const fn = OPS[body && body.op];
  if (!fn) throw httpError(400, `Unknown op. Expected one of: ${Object.keys(OPS).join(', ')}`);
  const out = await fn(knex, body, { dryRun: dry(body) });
  if (!dry(body)) await refreshLinkedRent(knex); // a renamed/merged rent category
  return out;
}

// PUT /api/admin/category-settings/:category — { requires_property?,
// allow_project_tag?, default_property_id?, dry_run? }. Preview reports how
// many transactions enter or leave the Needs-property queue.
export async function updateCategorySettings(knex, category, body) {
  const exists = await knex('categories').where({ name: category }).first('id');
  if (!exists) throw httpError(404, `Category '${category}' not found`);
  const before = await getCategorySetting(knex, category);
  const patch = {};
  for (const k of ['requires_property', 'allow_project_tag', 'default_property_id']) if (body && k in body) patch[k] = body[k];
  const unattributed = Number(
    await notAllocatedCount(knex, category),
  );
  const turningOn = patch.requires_property === true && !before.requires_property;
  const turningOff = patch.requires_property === false && before.requires_property;
  const changes = { queue_enter: turningOn ? unattributed : 0, queue_leave: turningOff ? unattributed : 0 };
  const parts = Object.entries(patch).map(([k, v]) => `${k} → ${v}`);
  const summary = `${category}: ${parts.join(', ') || 'no change'}`;
  if (dry(body)) return { dry_run: true, summary, changes, before };
  const result = await setCategorySetting(knex, category, patch);
  await writeAudit(knex, 'settings.update', summary, before, result.setting);
  return { dry_run: false, summary, changes, ...result };
}

// ── Property mapping ────────────────────────────────────────────────────────

// GET /api/admin/property-map — mappings, plus categories that look
// per-property (start with a number, or say Rent/PITI) but have no property.
export async function getPropertyMap(knex) {
  const [rows, tax, props] = await Promise.all([
    listPropertyCategoryMap(knex),
    cats.loadTaxonomy(knex),
    knex('owned_properties').select('id', 'address').orderBy('id'),
  ]);
  const mappedProps = new Map(rows.map((r) => [r.category, r.property_id]));
  const looksPerProperty = (n) => /^\d+\b/.test(n) || /\b(rent|piti|mortgage)\b/i.test(n);
  const unmapped = [...tax.byName.values()]
    .filter((c) => !c.archived && looksPerProperty(c.name) && mappedProps.get(c.name) == null)
    .map((c) => ({ category: c.name, group: c.group, dismissed: mappedProps.has(c.name) }));
  return { mappings: rows, unmapped, properties: props, roles: ROLES };
}

// PUT /api/admin/property-map — { category, property_id (null = not mapped),
// role, confirmed } or { confirm_all: true }.
export async function updatePropertyMap(knex, body) {
  const out = await savePropertyMap(knex, body);
  await refreshLinkedRent(knex); // an unmapped rent category stops being rent
  return out;
}

async function savePropertyMap(knex, body) {
  if (body && body.confirm_all) {
    const n = await knex('property_category_map').whereNotNull('property_id').where('confirmed', false).update({ confirmed: true });
    await writeAudit(knex, 'mapping.confirm_all', `Confirmed ${n} property mapping(s)`, null, { confirmed: n });
    return { success: true, confirmed: n };
  }
  const category = String(body?.category ?? '').trim();
  if (!(await knex('categories').where({ name: category }).first('id'))) throw httpError(400, `Category '${category}' not found`);
  const property_id = body.property_id == null || body.property_id === '' ? null : Number(body.property_id);
  if (property_id != null && !(await knex('owned_properties').where({ id: property_id }).first('id'))) {
    throw httpError(400, `Property ${property_id} not found`);
  }
  const role = body.role || 'income';
  if (!ROLES.includes(role)) throw httpError(400, `role must be one of: ${ROLES.join(', ')}`);
  const before = (await knex('property_category_map').where({ category }).first()) || null;
  const row = { category, property_id, role, confirmed: body.confirmed === undefined ? true : !!body.confirmed, updated_at: knex.fn.now() };
  await knex.transaction(async (trx) => {
    await trx('property_category_map').insert(row).onConflict('category').merge();
    await writeAudit(trx, 'mapping.update', `${category} → ${property_id == null ? 'not mapped' : `property ${property_id}`} (${role})`, before, row);
  });
  return { success: true, mapping: await knex('property_category_map').where({ category }).first() };
}

// ── Attribution ─────────────────────────────────────────────────────────────

// GET /api/admin/attribution — unattributed counts per category and per
// suggested property (from the current suggestions).
export async function getAttributionSummary(knex) {
  const rows = await unattributedQuery(knex).select('t.id', 't.description', 't.category', 't.amount');
  const ctx = await buildSuggestionContext(knex);
  const byCategory = {};
  const byProperty = {};
  for (const r of rows) {
    byCategory[r.category] = byCategory[r.category] || { category: r.category, count: 0, amount: 0 };
    byCategory[r.category].count += 1;
    byCategory[r.category].amount += Number(r.amount);
    const s = suggestFor(ctx, r)[0];
    const key = s ? s.property_id : 'none';
    byProperty[key] = byProperty[key] || { property_id: s ? s.property_id : null, address: s ? ctx.properties.find((p) => p.id === s.property_id)?.address : null, count: 0 };
    byProperty[key].count += 1;
  }
  const round = (o) => ({ ...o, amount: Math.round(o.amount * 100) / 100 });
  return {
    total: rows.length,
    by_category: Object.values(byCategory).map(round).sort((a, b) => b.count - a.count),
    by_suggested_property: Object.values(byProperty).sort((a, b) => b.count - a.count),
  };
}

// GET /api/admin/audit — the change log, newest first.
export async function getAudit(knex, query = {}) {
  return { entries: await listAudit(knex, { limit: query.limit }) };
}

// ── Rent from uploads ───────────────────────────────────────────────────────

// GET /api/admin/rent-backfill — preview recording rent_collections rows for
// rent payments already in transactions (lib/rentSync.js). Writes nothing.
// POST /api/admin/rent-backfill — { dry_run? } — apply it (idempotent).
export async function rentBackfill(knex, body = {}) {
  const dryRun = dry(body);
  const r = await syncRent(knex, null, { dryRun });
  if (!dryRun && r.created + r.updated + r.relinked + r.removed > 0) {
    await writeAudit(
      knex,
      'rent.backfill',
      `Recorded rent from transactions: ${r.created} created, ${r.updated} updated, ${r.relinked} relinked, ${r.removed} removed; ${r.already_recorded} already recorded, ${r.unmatched.length} need a unit`,
      null,
      { created: r.created, updated: r.updated, relinked: r.relinked, removed: r.removed, already_recorded: r.already_recorded, needs_unit: r.unmatched.length },
    );
  }
  return r;
}
