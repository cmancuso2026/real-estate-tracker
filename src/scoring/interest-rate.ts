import { config } from '../config.js';
import { getDb } from '../db/index.js';

/**
 * Freddie Mac PMMS 30-year fixed rate.
 *
 * The PMMS page (https://www.freddiemac.com/pmms) is backed by a published
 * historical CSV (PMMS_history.csv) whose columns include `pmms30` — the
 * 30-yr FRM rate — keyed by survey date. We pull the latest row, add the
 * investment-property premium, and store the effective rate for use in all
 * cash-flow math. The scheduler (Phase 6) refreshes this every Thursday.
 */

export interface RateSnapshot {
  baseRate: number; // 30-yr FRM, annual %
  premium: number; // investment premium, annual %
  effectiveRate: number; // base + premium
  weekDate: string | null; // PMMS survey date
}

interface ParsedPmms {
  baseRate: number;
  weekDate: string | null;
}

/** Fetch the most recent 30-yr fixed rate from Freddie Mac (or manual override). */
export async function fetchPmms30(): Promise<ParsedPmms> {
  const manual = config.manualPmmsRate;
  if (manual != null) {
    return { baseRate: manual, weekDate: null };
  }

  const res = await fetch(config.pmmsCsvUrl, {
    headers: { accept: 'text/csv,*/*' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Freddie Mac PMMS fetch failed: HTTP ${res.status}`);
  }
  const csv = await res.text();
  return parsePmmsCsv(csv);
}

/** Parse the PMMS historical CSV, returning the latest 30-yr fixed rate. */
export function parsePmmsCsv(csv: string): ParsedPmms {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error('PMMS CSV has no data rows');
  }

  const header = (lines[0] ?? '')
    .split(',')
    .map((h) => unquote(h).toLowerCase());
  // Prefer the canonical `pmms30` column; otherwise a "30"-year rate column
  // that isn't the points column (suffix "p") or the 15-yr column.
  let rateIdx = header.indexOf('pmms30');
  if (rateIdx === -1) {
    rateIdx = header.findIndex(
      (h) => h.includes('30') && !h.includes('15') && !/p$|point/.test(h),
    );
  }
  if (rateIdx === -1) {
    throw new Error(`Could not locate a 30-yr rate column in PMMS CSV header: ${header.join(',')}`);
  }

  // Walk from the end to the most recent row that has a numeric rate value.
  // Recent PMMS rows quote their values (e.g. "6.48"), so strip quotes first.
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = (lines[i] ?? '').split(',').map(unquote);
    const raw = cols[rateIdx];
    const rate = raw ? Number(raw) : NaN;
    if (Number.isFinite(rate) && rate > 0) {
      return { baseRate: rate, weekDate: cols[0] || null };
    }
  }
  throw new Error('No numeric 30-yr rate found in PMMS CSV');
}

/** Trim whitespace and strip a single pair of surrounding double quotes. */
function unquote(cell: string): string {
  return cell.trim().replace(/^"(.*)"$/, '$1').trim();
}

/** Fetch the latest rate, apply the premium, and persist it. Returns it. */
export async function refreshInterestRate(): Promise<RateSnapshot> {
  const { baseRate, weekDate } = await fetchPmms30();
  const premium = config.investmentRatePremium;
  const effectiveRate = round2(baseRate + premium);

  const snapshot: RateSnapshot = { baseRate, premium, effectiveRate, weekDate };
  storeRate(snapshot);
  return snapshot;
}

function storeRate(s: RateSnapshot): void {
  getDb()
    .prepare(
      `INSERT INTO interest_rates (source, week_date, base_rate, premium, effective_rate)
       VALUES ('freddie_mac_pmms', @weekDate, @baseRate, @premium, @effectiveRate)
       ON CONFLICT (source, week_date) DO UPDATE SET
         base_rate = excluded.base_rate,
         premium = excluded.premium,
         effective_rate = excluded.effective_rate,
         fetched_at = datetime('now')`,
    )
    .run({
      weekDate: s.weekDate,
      baseRate: s.baseRate,
      premium: s.premium,
      effectiveRate: s.effectiveRate,
    });
}

/** The most recently stored rate snapshot, or null if none stored yet. */
export function getStoredRate(): RateSnapshot | null {
  const row = getDb()
    .prepare(
      `SELECT base_rate, premium, effective_rate, week_date
       FROM interest_rates ORDER BY fetched_at DESC, id DESC LIMIT 1`,
    )
    .get() as
    | {
        base_rate: number;
        premium: number;
        effective_rate: number;
        week_date: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    baseRate: row.base_rate,
    premium: row.premium,
    effectiveRate: row.effective_rate,
    weekDate: row.week_date,
  };
}

/**
 * Returns the current effective rate to use for calculations. Uses the stored
 * rate if present; otherwise fetches once and stores it. The grader calls this
 * so a fresh DB still produces grades.
 */
export async function getEffectiveRate(): Promise<RateSnapshot> {
  return getStoredRate() ?? (await refreshInterestRate());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
