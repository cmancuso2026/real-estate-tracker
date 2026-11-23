# Copy finance data into the real-estate database

One-time copy of the finance data from the **old personal-finances Railway
Postgres** into the **real-estate (Mancuso HQ) Railway Postgres**, so the merged
app runs on a single `DATABASE_URL`.

Run it yourself from your Mac. Nothing here changes Railway settings. The only
database written to is the real-estate DB, and only its 4 finance tables.

What gets copied:

| Table | How |
|---|---|
| `transactions` | data copied (ids preserved) |
| `category_overrides` | data copied (ids preserved) |
| `upload_log` | data copied (ids preserved, so `transactions.upload_id` still points at the right upload) |
| `custom_categories` | data copied (ids preserved) |
| `knex_migrations` | **checked, not copied**. See "Why knex_migrations isn't copied" below |

These commands were rehearsed end to end on local Postgres 16 databases. The
source was built by the original finance app, and the target was migrated by
the merged app's `npm run db:migrate`.

---

## When to run it

1. **After** the merged app (Phase 2 or later) has deployed once to the
   real-estate service. Its boot runs `npm run db:migrate`, which creates the
   empty finance tables in the real-estate DB. Step 3 checks this.
2. **Before** you upload any statements to the merged app. The target finance
   tables must be empty. Step 4 checks this.
3. Ideally **before Phase 7 deploys**. Phase 7 seeds the new `categories` table
   from `custom_categories`. If you copy later, re-run that seed (it will be
   documented in Phase 7).

Stop using the old finance app (no uploads or edits) from Step 5 on. Anything
written to the old DB after the dump won't be copied.

## 0. Prerequisites

- `pg_dump`, `pg_restore` and `psql` on your Mac. Their version must be **at
  least** the Railway Postgres server version:

  ```bash
  brew install libpq && brew link --force libpq
  ```

  ```bash
  pg_dump --version
  ```

- Both databases' **public** connection URLs. In Railway, open each Postgres
  service → **Variables** → copy `DATABASE_PUBLIC_URL`. The plain
  `DATABASE_URL` uses a `*.railway.internal` host that your Mac can't reach.

```bash
export OLD_DB_URL='postgresql://…'   # old personal-finances Postgres (DATABASE_PUBLIC_URL)
```

```bash
export NEW_DB_URL='postgresql://…'   # real-estate Postgres (DATABASE_PUBLIC_URL)
```

Check the server versions (your `pg_dump --version` must be ≥ both):

```bash
psql "$OLD_DB_URL" -tAc "show server_version" && psql "$NEW_DB_URL" -tAc "show server_version"
```

## 1. Back up both databases (full, custom format)

```bash
pg_dump "$OLD_DB_URL" -Fc -f "finance-old-full-$(date +%Y%m%d-%H%M).dump"
```

```bash
pg_dump "$NEW_DB_URL" -Fc -f "hq-full-before-finance-$(date +%Y%m%d-%H%M).dump"
```

Keep these until you've used the merged app for a while.

## 2. Check the old DB's migrations

```bash
psql "$OLD_DB_URL" -c "select name from knex_migrations order by id"
```

Expected: exactly these 8 rows, in this order:

```
001_create_transactions.js
002_create_category_overrides.js
003_create_upload_log.js
004_create_custom_categories.js
005_add_review_cleared.js
006_add_note.js
007_add_confidence_score.js
008_dedupe_source_agnostic.js
```

If any are missing (especially `008`, which rewrites every `dedup_hash`),
**stop**. Deploy the latest personal-finances once so its own migrations run,
or tell me, before continuing. Copying pre-008 hashes would break dedup.

## 3. Check the real-estate DB already has the finance tables

```bash
psql "$NEW_DB_URL" -c "select name from knex_migrations order by id"
```

Expected: the same 8 names as Step 2 (plus any newer `009_…` from later phases).
If you get `relation "knex_migrations" does not exist`, the merged app hasn't
deployed yet. Deploy it, or run `npm run db:migrate` with
`DATABASE_URL="$NEW_DB_URL"`, then re-check.

## 4. Check the target finance tables are empty

```bash
psql "$NEW_DB_URL" -c "select (select count(*) from transactions) as transactions, (select count(*) from category_overrides) as overrides, (select count(*) from upload_log) as uploads, (select count(*) from custom_categories) as custom_categories"
```

All four must be `0`. If not (for example, a test upload to the new app),
**stop and tell me**. Restoring on top would fail on duplicate ids.

## 5. Record the source counts

```bash
psql "$OLD_DB_URL" -c "select (select count(*) from transactions) as transactions, (select count(*) from category_overrides) as overrides, (select count(*) from upload_log) as uploads, (select count(*) from custom_categories) as custom_categories, (select sum(amount) from transactions) as amount_sum, (select min(date) from transactions) as first_date, (select max(date) from transactions) as last_date"
```

Save the output; Step 8 compares against it.

## 6. Dump the 4 finance tables (data only)

```bash
pg_dump "$OLD_DB_URL" --data-only -Fc -t public.transactions -t public.category_overrides -t public.upload_log -t public.custom_categories -f finance-data.dump
```

## 7. Restore into the real-estate DB (one transaction: all or nothing)

```bash
pg_restore -d "$NEW_DB_URL" --data-only --single-transaction --no-owner --no-privileges --exit-on-error finance-data.dump
```

Then move each id sequence past the copied ids, so new uploads don't collide.
pg_dump usually carries the sequence values, but this makes sure:

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -c "select setval(pg_get_serial_sequence('transactions','id'), coalesce((select max(id) from transactions), 0) + 1, false), setval(pg_get_serial_sequence('category_overrides','id'), coalesce((select max(id) from category_overrides), 0) + 1, false), setval(pg_get_serial_sequence('upload_log','id'), coalesce((select max(id) from upload_log), 0) + 1, false), setval(pg_get_serial_sequence('custom_categories','id'), coalesce((select max(id) from custom_categories), 0) + 1, false)"
```

## 8. Verify

Run the Step 5 query against the new DB and compare. Every number must match:

```bash
psql "$NEW_DB_URL" -c "select (select count(*) from transactions) as transactions, (select count(*) from category_overrides) as overrides, (select count(*) from upload_log) as uploads, (select count(*) from custom_categories) as custom_categories, (select sum(amount) from transactions) as amount_sum, (select min(date) from transactions) as first_date, (select max(date) from transactions) as last_date"
```

Check every transaction still points at an upload that exists (expect `0`):

```bash
psql "$NEW_DB_URL" -tAc "select count(*) from transactions t where t.upload_id is not null and not exists (select 1 from upload_log u where u.id = t.upload_id)"
```

Check every override still matches a transaction (expect `0`). Old overrides
whose row was later deleted would show here; that's harmless, they just wait for
a re-upload:

```bash
psql "$NEW_DB_URL" -tAc "select count(*) from category_overrides o where not exists (select 1 from transactions t where t.dedup_hash = o.dedup_hash)"
```

If Step 7 failed, nothing was written (single transaction). Fix the cause and
re-run from Step 4.

## Why knex_migrations isn't copied

By Step 3, the real-estate DB's `knex_migrations` already lists the same
`001`–`008` files. The merged app ran them to create the empty tables you're
restoring into. Copying the old rows on top would fail with a duplicate key on
`knex_migrations.id`. Even with new ids, it would list every migration twice.
Steps 2 and 3 prove both databases are at the same migration state, which is
the only thing the copied table would have told Knex.

## Rollback

To undo the copy and get back to empty finance tables in the real-estate DB
(tracker tables untouched):

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -c "begin; truncate transactions, category_overrides, upload_log, custom_categories restart identity; commit;"
```

Or restore the full Step 1 backup of the real-estate DB.

## Afterwards

- Redeploy the web service, or run `npm run db:migrate` with
  `DATABASE_URL="$NEW_DB_URL"`. Each run adds any copied custom categories
  to the Admin category list (`categories`), and proposes property mappings
  (`property_category_map`) for per-property categories it hasn't seen yet,
  such as a custom "1821 Rent" that came over with the copy. They show up as
  unconfirmed on the Overview until you confirm them in Admin.

- Leave the old finance service and its database running, unused, until you're
  happy with the merged app. Then delete them in Railway yourself.
- After Phase 5 deploys, this gives the size of the "Needs property" backlog:

  ```bash
  psql "$NEW_DB_URL" -c "select t.category, count(*) from transactions t join category_settings s on s.category = t.category where s.requires_property and t.property_id is null group by t.category order by 2 desc"
  ```
