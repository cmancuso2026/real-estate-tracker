import { parseFile, parseFileAuto, SOURCES } from '../parsers/index.js';
import { buildHistoryIndex, categorizeWithHistory } from '../lib/categorize.js';
import { recategorizeUncategorized } from '../lib/recategorize.js';
import { dedupHash } from '../lib/dedup.js';
import { loadRules, matchRule } from '../lib/merchantRules.js';
import { canonicalName, loadTaxonomy } from '../lib/categories.js';
import { unattributedQuery } from '../lib/attribution.js';
import { syncRentQuietly } from '../lib/rentSync.js';
import { reapplyAllocations } from '../lib/allocations.js';
import { bofaDepositBalances } from '../parsers/balances.js';
import { fileToRows } from '../parsers/util.js';

const AMEX_LABELS = new Set(['Amex Gold', 'Amex Blue']);

/** 'amex:<account ending>' from an Amex export ("Account Ending 1-21004", or the Account # column), or null. */
function amexAccountKey(rows) {
  for (const row of rows.slice(0, 12)) {
    const m = (row || []).map((c) => String(c ?? '')).join(' ').match(/account ending\s+([\w-]+)/i);
    if (m) return `amex:${m[1]}`;
  }
  const h = rows.findIndex((r) => (r || []).some((c) => /^account\s*#$/i.test(String(c ?? '').trim())));
  if (h !== -1) {
    const col = rows[h].findIndex((c) => /^account\s*#$/i.test(String(c ?? '').trim()));
    const v = String((rows[h + 1] || [])[col] ?? '').trim();
    if (v) return `amex:${v}`;
  }
  return null;
}
import { saveFileBalances } from '../lib/balances.js';

// Same limits the Express route enforced through multer.
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file

// POST /api/finance/upload — multipart { files: [up to 20] }
//
// Every file's source format (Bank of America / Amex / SoFi) is auto-detected
// from its column headers — the client no longer specifies a source. All files
// are parsed, deduplicated across the whole batch AND against existing DB rows,
// then inserted in a single DB transaction. The response is a combined summary
// broken out by detected source.
//
// opts.sourceKey (optional, a SOURCES key such as 'amex_blue') parses every file
// with that bank's parser instead of detecting it — detection can't tell Amex
// Gold from Amex Blue (both files look the same), so the upload page lets you say.
export async function processUpload(knex, uploadedFiles, opts = {}) {
  const files = uploadedFiles || [];
  if (!files.length) {
    const e = new Error('No files uploaded (form field "files")');
    e.status = 400;
    throw e;
  }
  const sourceKey = opts.sourceKey || null;
  if (sourceKey && !SOURCES[sourceKey]) {
    const e = new Error(`Unknown source '${sourceKey}'. Expected one of: ${Object.keys(SOURCES).join(', ')}`);
    e.status = 400;
    throw e;
  }

  // Parse + auto-detect every file first. A file we can't recognize or parse
  // doesn't fail the whole batch — it's collected and reported back.
  const parsed = []; // { filename, source, transactions }
  const fileErrors = []; // { filename, error }
  // Cards remembered by account number (Amex Gold vs Blue look the same).
  const cardMap = (await knex.schema.hasTable('source_accounts'))
    ? new Map((await knex('source_accounts').select('account_key', 'source_key')).map((r) => [r.account_key, r.source_key]))
    : new Map();
  const learned = new Map(); // account_key → source_key picked on this upload
  files.forEach((f) => {
    try {
      let res = sourceKey ? { ...parseFile(f.buffer, f.originalname, sourceKey), sourceKey } : parseFileAuto(f.buffer, f.originalname);
      // Amex: which card is it? Picked on Upload → remember it for this account
      // number; detected → use the card remembered for it. Either way we're
      // sure of the card, so rows already here from this file get its label.
      let sureOfCard = false;
      if (AMEX_LABELS.has(res.source)) {
        const acct = amexAccountKey(fileToRows(f.buffer, f.originalname));
        if (sourceKey) {
          sureOfCard = true;
          if (acct) learned.set(acct, sourceKey);
        } else if (acct && cardMap.has(acct)) {
          sureOfCard = true;
          if (cardMap.get(acct) !== res.sourceKey) res = { ...parseFile(f.buffer, f.originalname, cardMap.get(acct)), sourceKey: cardMap.get(acct) };
        }
      }
      const { source, transactions } = res;
      // Bank of America checking exports also carry a running balance: kept for
      // the cash position chart (read separately; the transactions are unchanged).
      const balances = source === 'Bank of America' ? bofaDepositBalances(f.buffer, f.originalname) : null;
      parsed.push({ filename: f.originalname, source, transactions, balances, relabel: sureOfCard });
    } catch (err) {
      fileErrors.push({ filename: f.originalname, error: err.message });
    }
  });

  // Learn from already-categorized history so similar merchants inherit their
  // category by weighted vote (see lib/categorize.js). Snapshot it once for
  // the whole batch — new rows don't vote on each other.
  const historyRows = await knex('transactions')
    .whereNot('category', 'Uncategorized')
    .select('description', 'category', 'category_group', 'is_manual');
  const index = buildHistoryIndex(historyRows);
  // Your merchant rules run before the history vote and built-in rules; names
  // that were renamed or merged in Admin map to today's category.
  const [rules, tax] = await Promise.all([loadRules(knex), loadTaxonomy(knex)]);

  // Categorize + hash every parsed row, tagging it with which file it came
  // from (fileIdx) so we can attribute it to the right upload_log row later.
  const enriched = [];
  parsed.forEach((p, fileIdx) => {
    for (const t of p.transactions) {
      let { category, group, confidence } = categorizeWithHistory(
        t.description,
        t.rawCategory,
        p.source,
        index,
      );
      const rule = matchRule(rules, t.description);
      if (rule) {
        category = rule.category;
        confidence = null;
      }
      category = canonicalName(tax, category);
      group = tax.byName.get(category)?.group ?? group;
      enriched.push({
        fileIdx,
        row: {
          date: t.date,
          description: t.description,
          amount: t.amount,
          source: p.source,
          category,
          category_group: group,
          confidence_score: confidence,
          raw_description: t.rawDescription,
          dedup_hash: dedupHash(t.date, t.rawDescription, t.amount),
        },
        // a merchant rule with a property gives the row 100% to it (after insert)
        ruleAttr: rule && rule.property_id ? { property_id: rule.property_id, work_order_id: rule.work_order_id || null } : null,
      });
    }
  });

  // Collapse duplicates WITHIN this batch (first occurrence wins). The hash is
  // the same whichever account the row came from (date, description, amount).
  const seen = new Set();
  const batch = [];
  for (const e of enriched) {
    if (seen.has(e.row.dedup_hash)) continue;
    seen.add(e.row.dedup_hash);
    batch.push(e);
  }

  // Drop rows already present in the DB.
  const hashes = batch.map((e) => e.row.dedup_hash);
  const existingRows = hashes.length
    ? await knex('transactions').whereIn('dedup_hash', hashes).select('dedup_hash')
    : [];
  const existing = new Set(existingRows.map((r) => r.dedup_hash));
  const toInsert = batch.filter((e) => !existing.has(e.row.dedup_hash));

  // Apply any persisted category overrides so user edits survive re-uploads.
  const insertHashes = toInsert.map((e) => e.row.dedup_hash);
  const overrideRows = insertHashes.length
    ? await knex('category_overrides').whereIn('dedup_hash', insertHashes).select('*')
    : [];
  const overrides = new Map(overrideRows.map((o) => [o.dedup_hash, o]));
  for (const e of toInsert) {
    const o = overrides.get(e.row.dedup_hash);
    if (o) {
      e.row.category = o.category;
      e.row.category_group = o.category_group;
      e.row.is_manual = true;
      e.row.confidence_score = null; // user-set, not auto-scored
    }
  }

  // Re-apply saved property/project attribution the same way, so it survives a
  // row being deleted and imported again. That happens after the insert below
  // (allocations need the new ids): a saved split wins over a merchant rule.
  const savedAttr = new Set(
    insertHashes.length
      ? (await knex('attribution_overrides').whereIn('dedup_hash', insertHashes).select('dedup_hash')).map((o) => o.dedup_hash)
      : [],
  );

  // ── Per-file and per-source tallies ──────────────────────────────────────
  // processed = every parsed row; new = rows actually inserted; skipped is the
  // remainder (both intra-batch and already-in-DB duplicates).
  const perFile = parsed.map((p) => ({ processed: p.transactions.length, new: 0 }));
  const bySource = {};
  const sourceOf = (name) =>
    bySource[name] || (bySource[name] = { source: name, processed: 0, new_rows: 0, skipped: 0 });
  for (const e of enriched) sourceOf(e.row.source).processed += 1;
  for (const e of toInsert) {
    perFile[e.fileIdx].new += 1;
    sourceOf(e.row.source).new_rows += 1;
  }
  for (const s of Object.values(bySource)) s.skipped = s.processed - s.new_rows;

  const totalRows = enriched.length;
  const newRows = toInsert.length;
  const skipped = totalRows - newRows;

  // ── Insert everything atomically ─────────────────────────────────────────
  // One upload_log row per file (preserves provenance); each transaction links
  // to its originating file's upload_id.
  const uploadIds = [];
  let balancesSaved = 0;
  let relabeled = 0;
  await knex.transaction(async (trx) => {
    const fileUploadId = new Array(parsed.length).fill(null);
    for (let i = 0; i < parsed.length; i += 1) {
      const p = parsed[i];
      const inserted = await trx('upload_log')
        .insert({
          filename: p.filename,
          source: p.source,
          row_count: perFile[i].processed,
          new_rows: perFile[i].new,
          skipped: perFile[i].processed - perFile[i].new,
        })
        .returning('id');
      const id = inserted[0].id ?? inserted[0];
      fileUploadId[i] = id;
      uploadIds.push(id);

    }

    // Amex rows already here from a file whose card we're sure of: give them that
    // card's label (they were labeled Amex Gold before the card could be picked).
    for (let i = 0; i < parsed.length; i += 1) {
      if (!parsed[i].relabel) continue;
      const dupHashes = enriched.filter((e) => e.fileIdx === i && existing.has(e.row.dedup_hash)).map((e) => e.row.dedup_hash);
      for (let k = 0; k < dupHashes.length; k += 500) {
        relabeled += await trx('transactions')
          .whereIn('dedup_hash', dupHashes.slice(k, k + 500))
          .whereIn('source', [...AMEX_LABELS])
          .whereNot('source', parsed[i].source)
          .update({ source: parsed[i].source });
      }
    }
    for (const [account_key, source_key] of learned) {
      await trx('source_accounts').insert({ account_key, source_key, updated_at: trx.fn.now() }).onConflict('account_key').merge();
    }

    // Daily balances (BofA checking / savings), oldest file first so statements chain up.
    const withBal = parsed.map((p, i) => [p, fileUploadId[i]]).filter(([p]) => p.balances && p.balances.points.length);
    withBal.sort((x, y) => x[0].balances.points[0].date.localeCompare(y[0].balances.points[0].date));
    for (const [p, uid] of withBal) balancesSaved += (await saveFileBalances(trx, p.balances, uid)).saved;

    if (toInsert.length) {
      const inserted = await trx('transactions')
        .insert(toInsert.map((e) => ({ ...e.row, upload_id: fileUploadId[e.fileIdx] })))
        .returning(['id', 'dedup_hash', 'amount']);
      await reapplyAllocations(trx, inserted.filter((r) => savedAttr.has(r.dedup_hash)));
      const ruleByHash = new Map(toInsert.filter((e) => e.ruleAttr).map((e) => [e.row.dedup_hash, e.ruleAttr]));
      const byRule = inserted.filter((r) => !savedAttr.has(r.dedup_hash) && ruleByHash.has(r.dedup_hash));
      if (byRule.length) {
        await trx('transaction_allocations').insert(
          byRule.map((r) => ({ transaction_id: r.id, property_id: ruleByHash.get(r.dedup_hash).property_id, unit_id: null, work_order_id: ruleByHash.get(r.dedup_hash).work_order_id, amount: r.amount, percent: 100, input_mode: 'percent' })),
        );
      }
    }
  });

  // Now that this batch's rows are in, re-sweep older Uncategorized rows: the
  // added history may newly identify recurring merchants (e.g. a payroll
  // deposit) so "stuff like this" gets picked up without manual action.
  let recategorized = 0;
  const lastRecategorizedIds = [];
  try {
    ({ updated: recategorized } = await recategorizeUncategorized(knex, { changedIds: lastRecategorizedIds }));
  } catch (e) {
    // A failed re-sweep must not fail the upload itself.
    console.error('post-upload recategorize failed', e);
  }

  // Rent payments among the new rows (and rows the re-sweep just categorized)
  // go to rent_collections; ones without a clear unit wait in "Rent needs a
  // unit". Then count how many new rows now need a property.
  const newIds = insertHashes.length
    ? (await knex('transactions').whereIn('dedup_hash', insertHashes).select('id')).map((r) => r.id)
    : [];
  let rent = { matched: 0, already_recorded: 0, needs_unit: 0 };
  let needsProperty = 0;
  try {
    const sync = await syncRentQuietly(knex, [...new Set([...newIds, ...lastRecategorizedIds])]);
    if (sync) rent = { matched: sync.created + sync.updated + sync.relinked, already_recorded: sync.already_recorded, needs_unit: sync.unmatched.length };
    if (newIds.length) {
      const row = await unattributedQuery(knex).whereIn('t.id', newIds).count({ c: '*' }).first();
      needsProperty = Number(row.c);
    }
  } catch (e) {
    console.error('post-upload summary failed', e);
  }

  return {
    success: true,
    files: files.length,
    files_parsed: parsed.length,
    total_rows: totalRows,
    new_rows: newRows,
    skipped,
    recategorized,
    needs_property: needsProperty,
    balances_saved: balancesSaved,
    relabeled,
    rent,
    by_source: Object.values(bySource),
    errors: fileErrors,
    upload_ids: uploadIds,
  };
}

