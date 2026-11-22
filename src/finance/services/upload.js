import { parseFileAuto } from '../parsers/index.js';
import { buildHistoryIndex, categorizeWithHistory } from '../lib/categorize.js';
import { recategorizeUncategorized } from '../lib/recategorize.js';
import { dedupHash } from '../lib/dedup.js';

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
export async function processUpload(knex, uploadedFiles) {
  const files = uploadedFiles || [];
  if (!files.length) {
    const e = new Error('No files uploaded (form field "files")');
    e.status = 400;
    throw e;
  }

  // Parse + auto-detect every file first. A file we can't recognize or parse
  // doesn't fail the whole batch — it's collected and reported back.
  const parsed = []; // { filename, source, transactions }
  const fileErrors = []; // { filename, error }
  files.forEach((f) => {
    try {
      const { source, transactions } = parseFileAuto(f.buffer, f.originalname);
      parsed.push({ filename: f.originalname, source, transactions });
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

  // Categorize + hash every parsed row, tagging it with which file it came
  // from (fileIdx) so we can attribute it to the right upload_log row later.
  const enriched = [];
  parsed.forEach((p, fileIdx) => {
    for (const t of p.transactions) {
      const { category, group, confidence } = categorizeWithHistory(
        t.description,
        t.rawCategory,
        p.source,
        index,
      );
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
      });
    }
  });

  // Collapse duplicates WITHIN this batch (first occurrence wins). The hash
  // includes the source, so rows from different sources never collide.
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

    if (toInsert.length) {
      await trx('transactions').insert(
        toInsert.map((e) => ({ ...e.row, upload_id: fileUploadId[e.fileIdx] })),
      );
    }
  });

  // Now that this batch's rows are in, re-sweep older Uncategorized rows: the
  // added history may newly identify recurring merchants (e.g. a payroll
  // deposit) so "stuff like this" gets picked up without manual action.
  let recategorized = 0;
  try {
    ({ updated: recategorized } = await recategorizeUncategorized(knex));
  } catch (e) {
    // A failed re-sweep must not fail the upload itself.
    console.error('post-upload recategorize failed', e);
  }

  return {
    success: true,
    files: files.length,
    files_parsed: parsed.length,
    total_rows: totalRows,
    new_rows: newRows,
    skipped,
    recategorized,
    by_source: Object.values(bySource),
    errors: fileErrors,
    upload_ids: uploadIds,
  };
}

