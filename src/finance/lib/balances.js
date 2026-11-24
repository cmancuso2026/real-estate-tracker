// Cash position: daily closing balances (account_balances) saved from bank
// exports, one series per account, and the summaries the Overview pages show.
//
// Bank of America checking and savings exports look the same and don't name
// the account, so each uploaded file is matched to an account by its numbers:
//   1. it continues an account: the file's opening balance equals that
//      account's balance just before the file starts (or the account's next
//      balance equals the file's last one — uploaded out of order), or
//   2. it overlaps an account and agrees with it on every shared day;
//   3. otherwise it's a new account (named Checking / Savings — renamable;
//      renaming it to an existing account's name merges the two).
// Each file's opening balance is stored as the previous day's closing balance,
// so consecutive statements share a day whichever order they're uploaded in.
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/** The balance in force on a date: the last closing balance on or before it (null before the first). */
export function balanceOn(points, date) {
  let found = null;
  for (const p of points) {
    if (p.date <= date) found = p;
    else break;
  }
  return found;
}

async function seriesByAccount(knex) {
  const rows = await knex('account_balances').select('account', 'date', 'balance').orderBy('account').orderBy('date');
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.account)) by.set(r.account, []);
    by.get(r.account).push({ date: ymd(r.date), balance: r2(r.balance) });
  }
  return by;
}

/** Which account a file's balances belong to (see the rules above). */
export async function matchAccount(knex, file) {
  const accounts = await seriesByAccount(knex);
  const first = file.points[0]?.date ?? file.begin?.date;
  const strong = [];
  const clean = [];
  for (const [account, pts] of accounts) {
    const have = new Map(pts.map((p) => [p.date, p.balance]));
    const shared = file.points.filter((p) => have.has(p.date));
    const conflict = shared.some((p) => !near(p.balance, have.get(p.date)));
    if (!conflict) clean.push(account);
    const before = pts.filter((p) => p.date < first);
    const continues = file.begin && before.length && near(before[before.length - 1].balance, file.begin.balance);
    // or the account carries on after this file: its next balance is this file's last one (uploaded out of order)
    const lastF = file.points[file.points.length - 1];
    const after = pts.filter((p) => p.date > lastF.date);
    const precedes = after.length && near(after[0].balance, lastF.balance);
    if (!conflict && (continues || precedes || shared.length > 0)) strong.push(account);
  }
  if (strong.length === 1) return strong[0];
  // a new account: Checking / Savings (by the file's contents), numbered if taken
  let name = file.kind || 'Checking';
  for (let n = 2; accounts.has(name); n += 1) name = `${file.kind || 'Checking'} ${n}`;
  return name;
}

/** Save one file's daily balances to its account (later uploads of a day win). → { account, saved } */
export async function saveFileBalances(knex, file, uploadId = null) {
  if (!file || !file.points.length) return { account: null, saved: 0 };
  const account = await matchAccount(knex, file);
  for (const p of file.points) {
    await knex('account_balances')
      .insert({ account, date: p.date, balance: p.balance, upload_id: uploadId })
      .onConflict(['account', 'date'])
      .merge(['balance', 'upload_id']);
  }
  return { account, saved: file.points.length };
}

/** Total cash on each date: every account's balance in force that day, summed (from when all have started). */
export function totalSeries(accounts) {
  if (!accounts.length) return [];
  const start = accounts.map((a) => a.points[0]?.date).filter(Boolean).sort().pop();
  const dates = [...new Set(accounts.flatMap((a) => a.points.map((p) => p.date)))].filter((d) => d >= start).sort();
  return dates.map((date) => ({ date, balance: r2(accounts.reduce((s, a) => s + (balanceOn(a.points, date)?.balance ?? 0), 0)) }));
}

const monthEnds = (points) => {
  const m = new Map();
  for (const p of points) m.set(p.date.slice(0, 7), p.balance);
  return [...m.entries()].map(([month, balance]) => ({ month, balance }));
};

/**
 * GET /api/finance/balances → { accounts: [{ account, points, latest, month_ends }],
 * total: { points, latest, month_ends } | null }
 */
export async function getBalances(knex) {
  if (!(await knex.schema.hasTable('account_balances'))) return { accounts: [], total: null };
  const by = await seriesByAccount(knex);
  const accounts = [...by.entries()].map(([account, points]) => ({
    account,
    points,
    latest: points[points.length - 1] ?? null,
    month_ends: monthEnds(points),
  }));
  const tp = totalSeries(accounts);
  return {
    accounts,
    total: tp.length ? { points: tp, latest: tp[tp.length - 1], month_ends: monthEnds(tp) } : null,
  };
}

/** PATCH /api/finance/balances — { from, to } renames an account. */
export async function renameAccount(knex, body = {}) {
  const from = String(body.from ?? '').trim();
  const to = String(body.to ?? '').trim();
  if (!from || !to) throw Object.assign(new Error('Both the current and the new name are required'), { status: 400 });
  if (from === to) return { success: true, renamed: 0, merged: false };
  const target = await knex('account_balances').where({ account: to }).select('date', 'balance');
  if (target.length) {
    // merge into an existing account: only if no shared day disagrees
    const have = new Map(target.map((r) => [ymd(r.date), Number(r.balance)]));
    const mine = await knex('account_balances').where({ account: from }).select('id', 'date', 'balance');
    const clash = mine.find((r) => have.has(ymd(r.date)) && !near(have.get(ymd(r.date)), r.balance));
    if (clash) throw Object.assign(new Error(`Can't merge: on ${ymd(clash.date)} “${from}” and “${to}” have different balances`), { status: 400 });
    const dupIds = mine.filter((r) => have.has(ymd(r.date))).map((r) => r.id);
    if (dupIds.length) await knex('account_balances').whereIn('id', dupIds).del();
    const n = await knex('account_balances').where({ account: from }).update({ account: to });
    return { success: true, renamed: n, merged: true };
  }
  const n = await knex('account_balances').where({ account: from }).update({ account: to });
  return { success: true, renamed: n, merged: false };
}

/**
 * For the landing page: total cash (and each account) — latest balance, change
 * over 30 days and this year, month-end trend.
 */
export async function cashSummary(knex) {
  const { accounts, total } = await getBalances(knex);
  if (!total) return null;
  const pts = total.points;
  const latest = total.latest;
  const d30 = new Date(latest.date + 'T00:00:00Z');
  d30.setUTCDate(d30.getUTCDate() - 30);
  const ago30 = balanceOn(pts, d30.toISOString().slice(0, 10));
  // end of last year, or (when the history starts this year) the first balance this year
  const yearStart = balanceOn(pts, `${Number(latest.date.slice(0, 4)) - 1}-12-31`) ?? pts.find((p) => p.date.startsWith(latest.date.slice(0, 4))) ?? null;
  return {
    latest,
    change_30d: ago30 ? r2(latest.balance - ago30.balance) : null,
    change_ytd: yearStart ? r2(latest.balance - yearStart.balance) : null,
    month_ends: total.month_ends.slice(-12),
    accounts: accounts.map((a) => ({ account: a.account, latest: a.latest })),
  };
}
