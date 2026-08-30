const express = require('express');
const multer = require('multer');

const { parseFile } = require('../parsers');
const { buildHistoryIndex, categorizeWithHistory } = require('../lib/categorize');
const { dedupHash } = require('../lib/dedup');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// POST /api/upload — multipart { file, source }
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const knex = req.app.locals.db;
    const sourceKey = req.body.source;
    if (!req.file) {
      const e = new Error('No file uploaded (form field "file")');
      e.status = 400;
      throw e;
    }

    const { source, transactions } = parseFile(req.file.buffer, req.file.originalname, sourceKey);
    const totalRows = transactions.length;

    // Learn from already-categorized history so similar merchants inherit their
    // category by weighted vote (see lib/categorize.js). Snapshot it once for
    // the whole batch — new rows don't vote on each other.
    const historyRows = await knex('transactions')
      .whereNot('category', 'Uncategorized')
      .select('description', 'category', 'category_group', 'is_manual');
    const index = buildHistoryIndex(historyRows);

    // Categorize + hash every parsed row.
    const enriched = transactions.map((t) => {
      const { category, group, confidence } = categorizeWithHistory(
        t.description,
        t.rawCategory,
        source,
        index,
      );
      return {
        date: t.date,
        description: t.description,
        amount: t.amount,
        source,
        category,
        category_group: group,
        confidence_score: confidence,
        raw_description: t.rawDescription,
        dedup_hash: dedupHash(t.date, t.rawDescription, t.amount, source),
      };
    });

    // Collapse duplicates within this same file (first occurrence wins).
    const seen = new Set();
    const batch = [];
    for (const row of enriched) {
      if (seen.has(row.dedup_hash)) continue;
      seen.add(row.dedup_hash);
      batch.push(row);
    }

    // Drop rows already present in the DB.
    const hashes = batch.map((r) => r.dedup_hash);
    const existingRows = hashes.length
      ? await knex('transactions').whereIn('dedup_hash', hashes).select('dedup_hash')
      : [];
    const existing = new Set(existingRows.map((r) => r.dedup_hash));
    const toInsert = batch.filter((r) => !existing.has(r.dedup_hash));

    // Apply any persisted category overrides so user edits survive re-uploads.
    const insertHashes = toInsert.map((r) => r.dedup_hash);
    const overrideRows = insertHashes.length
      ? await knex('category_overrides').whereIn('dedup_hash', insertHashes).select('*')
      : [];
    const overrides = new Map(overrideRows.map((o) => [o.dedup_hash, o]));
    for (const row of toInsert) {
      const o = overrides.get(row.dedup_hash);
      if (o) {
        row.category = o.category;
        row.category_group = o.category_group;
        row.is_manual = true;
        row.confidence_score = null; // user-set, not auto-scored
      }
    }

    const newRows = toInsert.length;
    const skipped = totalRows - newRows;

    let uploadId = null;
    await knex.transaction(async (trx) => {
      const inserted = await trx('upload_log')
        .insert({
          filename: req.file.originalname,
          source,
          row_count: totalRows,
          new_rows: newRows,
          skipped,
        })
        .returning('id');
      uploadId = inserted[0].id ?? inserted[0];

      if (toInsert.length) {
        await trx('transactions').insert(toInsert.map((r) => ({ ...r, upload_id: uploadId })));
      }
    });

    res.json({
      success: true,
      source,
      total_rows: totalRows,
      new_rows: newRows,
      skipped,
      upload_id: uploadId,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
