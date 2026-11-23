// Your merchant rules (merchant_rules). They run BEFORE the built-in logic
// (history vote, then lib/categorize.js rules) on upload and recategorize; a
// saved per-transaction override still wins over everything. Lower priority
// numbers run first; the first enabled rule that matches wins. A rule with a
// property also sets the transaction's property (and project) attribution.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHistoryIndex, categorize, categorizeWithHistory } from './categorize.js';
import { validateAttribution } from './attribution.js';
import { writeAudit } from './audit.js';
import { canonicalName, loadTaxonomy } from './categories.js';
import { syncRentQuietly } from './rentSync.js';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
export const MATCH_TYPES = ['contains', 'regex'];

// A boolean column value as stored (true from Postgres; '1'/'0' style values
// from in-memory test databases filling a Knex default).
const isTrue = (v) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';

/** A matcher for one rule row, or null if it can't compile. */
export function compileRule(r) {
  if (r.match_type === 'regex') {
    try {
      const re = new RegExp(r.pattern, 'i');
      return (desc) => re.test(String(desc || ''));
    } catch {
      return null;
    }
  }
  const needle = String(r.pattern || '').trim().toUpperCase();
  if (!needle) return null;
  return (desc) => String(desc || '').toUpperCase().includes(needle);
}

/** Enabled rules in run order, each with .matches(description). */
export function compileRules(rows) {
  return rows
    .filter((r) => r.enabled)
    .sort((a, b) => Number(a.priority) - Number(b.priority) || a.id - b.id)
    .map((r) => ({ ...r, matches: compileRule(r) }))
    .filter((r) => r.matches);
}

export async function loadRules(knex) {
  return compileRules(await knex('merchant_rules').select('*'));
}

/** The first rule that matches, or null. */
export function matchRule(rules, description) {
  return rules.find((r) => r.matches(description)) || null;
}

// ── CRUD (with change log) ──────────────────────────────────────────────────

async function validateRule(knex, body) {
  const pattern = String(body.pattern ?? '').trim();
  if (!pattern) throw httpError(400, 'Pattern is required');
  const match_type = body.match_type || 'contains';
  if (!MATCH_TYPES.includes(match_type)) throw httpError(400, `match_type must be one of: ${MATCH_TYPES.join(', ')}`);
  if (match_type === 'regex') {
    try {
      new RegExp(pattern, 'i');
    } catch (e) {
      throw httpError(400, `Invalid regular expression: ${e.message}`);
    }
  }
  const category = String(body.category ?? '').trim();
  const c = await knex('categories').where({ name: category, archived: false }).first('id');
  if (!c) throw httpError(400, `Category '${category}' doesn't exist (or is archived)`);
  const attr = await validateAttribution(knex, { property_id: body.property_id ?? null, work_order_id: body.work_order_id ?? null });
  const priority = body.priority == null || body.priority === '' ? 100 : Number(body.priority);
  if (!Number.isInteger(priority)) throw httpError(400, 'priority must be a whole number');
  return {
    pattern,
    match_type,
    category,
    property_id: attr.property_id,
    work_order_id: attr.work_order_id,
    priority,
    enabled: body.enabled === undefined ? true : !!body.enabled,
  };
}

export async function listRules(knex) {
  return knex('merchant_rules as r')
    .leftJoin('owned_properties as p', 'p.id', 'r.property_id')
    .leftJoin('work_orders as w', 'w.id', 'r.work_order_id')
    .select('r.*', 'p.address as property_name', 'w.project_name')
    .orderBy('r.priority')
    .orderBy('r.id');
}

export async function createRule(knex, body) {
  const row = await validateRule(knex, body || {});
  return knex.transaction(async (trx) => {
    const [created] = await trx('merchant_rules').insert(row).returning('*');
    await writeAudit(trx, 'rule.create', `Add rule “${row.pattern}” → ${row.category}`, null, created);
    return created;
  });
}

export async function updateRule(knex, id, body) {
  const before = await knex('merchant_rules').where({ id: Number(id) }).first();
  if (!before) throw httpError(404, `Rule ${id} not found`);
  const row = await validateRule(knex, { ...before, ...(body || {}) });
  return knex.transaction(async (trx) => {
    const [after] = await trx('merchant_rules').where({ id: before.id }).update({ ...row, updated_at: trx.fn.now() }).returning('*');
    await writeAudit(trx, 'rule.update', `Edit rule “${after.pattern}” → ${after.category}`, before, after);
    return after;
  });
}

export async function deleteRule(knex, id) {
  const before = await knex('merchant_rules').where({ id: Number(id) }).first();
  if (!before) throw httpError(404, `Rule ${id} not found`);
  await knex.transaction(async (trx) => {
    await trx('merchant_rules').where({ id: before.id }).del();
    await writeAudit(trx, 'rule.delete', `Delete rule “${before.pattern}”`, before, null);
  });
  return { success: true };
}

/**
 * Apply one rule to existing transactions (not to manual ones — your own edits
 * always win). Dry run → counts + a sample. Real run → one transaction + log.
 */
export async function applyRuleToExisting(knex, id, { dryRun = false } = {}) {
  const rule = await knex('merchant_rules').where({ id: Number(id) }).first();
  if (!rule) throw httpError(404, `Rule ${id} not found`);
  const matches = compileRule(rule);
  if (!matches) throw httpError(400, 'This rule has an invalid pattern');
  const tax = await loadTaxonomy(knex);
  const group = tax.byName.get(rule.category)?.group ?? 'Other';
  // Manual rows (your own edits) are never touched. Filtered here rather than in
  // SQL so it holds for rows whose is_manual came from the column default.
  const rows = (await knex('transactions').select('id', 'date', 'description', 'category', 'is_manual', 'amount')).filter(
    (t) => !isTrue(t.is_manual) && matches(t.description),
  );
  const recat = rows.filter((t) => t.category !== rule.category);
  const allocated = new Set(
    rule.property_id && rows.length
      ? (await knex('transaction_allocations').whereIn('transaction_id', rows.map((t) => t.id)).distinct('transaction_id')).map((a) => Number(a.transaction_id))
      : [],
  );
  // rows with no allocation yet get 100% to the rule's property
  const attrib = rule.property_id ? rows.filter((t) => !allocated.has(Number(t.id)) && Number(t.amount) !== 0) : [];
  const plan = {
    summary: `Apply rule “${rule.pattern}” → ${rule.category} to existing transactions`,
    changes: { recategorized: recat.length, attributed: attrib.length, matched: rows.length },
    sample: recat.slice(0, 10).map((t) => ({ id: t.id, description: t.description, from: t.category, to: rule.category })),
  };
  if (dryRun) return { dry_run: true, ...plan };
  await knex.transaction(async (trx) => {
    if (recat.length) {
      await trx('transactions').whereIn('id', recat.map((t) => t.id)).update({ category: rule.category, category_group: group, confidence_score: null });
    }
    if (attrib.length) {
      await trx('transaction_allocations').insert(
        attrib.map((t) => ({ transaction_id: t.id, property_id: rule.property_id, unit_id: null, work_order_id: rule.work_order_id || null, amount: t.amount, percent: 100, input_mode: 'percent' })),
      );
    }
    await writeAudit(trx, 'rule.apply', plan.summary, { rule_id: rule.id }, plan.changes);
  });
  await syncRentQuietly(knex, recat.map((t) => t.id));
  return { dry_run: false, ...plan };
}

// ── Built-in rules (read-only view) ─────────────────────────────────────────

/** Plain words for a condition in categorize.js, e.g. has(desc, 'A', 'B') → description contains “A” or “B”. */
function describeCondition(cond) {
  const list = (args) => [...args.matchAll(/'([^']+)'/g)].map((x) => `“${x[1]}”`).join(' or ');
  return cond
    .replace(/has\(desc,\s*([^)]*)\)/g, (_, args) => `description contains ${list(args)}`)
    .replace(/has\(raw,\s*([^)]*)\)/g, (_, args) => `bank category/type contains ${list(args)}`)
    .replace(/\/((?:[^/\\]|\\.)+)\/\.test\(desc\)/g, (_, re) => `description matches /${re}/`)
    .replace(/\s*&&\s*/g, ' and ');
}

const RULESETS = { bankofamericaRules: 'Bank of America', amexRules: 'Amex', sofiRules: 'SoFi', capitalOneRules: 'Capital One' };

/**
 * The built-in rules from lib/categorize.js, read from its source so this view
 * can't drift from what runs. Per bank: rules in order (first match wins).
 */
export function builtinRules() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'categorize.js');
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const fnRe = /function (\w+Rules)\(([^)]*)\) \{([\s\S]*?)\n\}/g;
  let m;
  while ((m = fnRe.exec(src))) {
    if (!RULESETS[m[1]]) continue;
    const rules = [];
    for (const line of m[3].split('\n')) {
      const r = line.match(/if \((.*)\) return '([^']+)';(?:\s*\/\/\s*(.*))?/);
      if (!r) continue;
      rules.push({ when: describeCondition(r[1]), category: r[2], note: r[3] || null });
    }
    out.push({ source: RULESETS[m[1]], rules, otherwise: 'Uncategorized' });
  }
  return out;
}

/**
 * Which rule wins for a description, step by step — the same order upload uses:
 * your rules → history vote → built-in rules. (A saved override for an exact
 * transaction would win over all of these.)
 */
export async function testDescription(knex, { description, source }) {
  const desc = String(description || '');
  const src = String(source || 'Bank of America');
  const [rules, tax, history] = await Promise.all([
    loadRules(knex),
    loadTaxonomy(knex),
    knex('transactions').whereNot('category', 'Uncategorized').select('description', 'category', 'category_group', 'is_manual'),
  ]);
  const rule = matchRule(rules, desc);
  const hist = categorizeWithHistory(desc, '', src, buildHistoryIndex(history));
  const builtin = categorize(desc, '', src);
  const steps = [
    { step: 'your rules', result: rule ? { category: rule.category, rule_id: rule.id, pattern: rule.pattern, property_id: rule.property_id } : null },
    { step: 'history vote', result: hist.confidence != null && hist.category !== 'Uncategorized' ? { category: hist.category, confidence: hist.confidence } : null },
    { step: 'built-in rules', result: { category: builtin.category } },
  ];
  const winner = rule
    ? { from: 'your rule', category: rule.category }
    : hist.confidence != null
      ? { from: hist.category === 'Uncategorized' ? 'history (not confident enough)' : 'history vote', category: hist.category }
      : { from: 'built-in rule', category: builtin.category };
  winner.category = canonicalName(tax, winner.category);
  return { description: desc, source: src, steps, winner };
}
