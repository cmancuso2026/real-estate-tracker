import { MAX_FILE_BYTES, MAX_FILES, processUpload } from '@finance/services/upload.js';
import { httpError, run } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// POST /api/finance/upload — multipart form, up to 20 files in field "files",
// and optional field "source" (bankofamerica, amex_gold, amex_blue, sofi,
// capitalone; empty = detect each file's bank from its headers).
// → { success, files, files_parsed, total_rows, new_rows, skipped,
// recategorized, needs_property, rent: { matched, already_recorded,
// needs_unit }, by_source, errors, upload_ids }
export async function POST(req: Request) {
  return run(async (knex) => {
    let form: FormData | null = null;
    try {
      form = await req.formData();
    } catch {
      form = null; // not multipart → "no files", same as the Express route
    }
    const entries = (form?.getAll('files') ?? []).filter(
      (f): f is File => typeof f !== 'string',
    );
    if (entries.length > MAX_FILES) {
      throw httpError(400, `Too many files (max ${MAX_FILES} per upload)`);
    }
    const files = [];
    for (const f of entries) {
      if (f.size > MAX_FILE_BYTES) {
        throw httpError(400, `File too large: ${f.name} (max 15 MB)`);
      }
      files.push({ buffer: Buffer.from(await f.arrayBuffer()), originalname: f.name });
    }
    const source = form?.get('source');
    return processUpload(knex, files, { sourceKey: typeof source === 'string' && source ? source : null });
  });
}
