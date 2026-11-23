// Cash position: daily closing balances (account_balances) saved from bank
// exports, and the summaries the Overview pages show.
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Upsert one account's daily balances (later uploads of a day win). → rows written */
export async function saveBalances(knex, account, points, uploadId = null) {
  let n = 0;
  for (const p of points) {
    await knex('account_balances')
      .insert({ account, date: p.date, balance: p.balance, upload_id: uploadId })
      .onConflict(['account', 'date'])
      .merge(['balance', 'upload_id']);
    n += 1;
  }
  return n;
}

/** The balance in force on a date: the last closing balance on or before it (null before the first). */
export function balanceOn(points, date) {
  let found = null;
  for (const p of points) {
    if (p.date <= date) found = p;
    else break;
  }
  return found;
}

/**
 * GET /api/finance/balances → { accounts: [{ account, points: [{date, balance}],
 * latest, month_ends: [{month, balance}] }] } (points sorted by date).
 */
export async function getBalances(knex) {
  if (!(await knex.schema.hasTable('account_balances'))) return { accounts: [] };
  const rows = await knex('account_balances').select('account', 'date', 'balance').orderBy('account').orderBy('date');
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.account)) by.set(r.account, []);
    by.get(r.account).push({ date: ymd(r.date), balance: r2(r.balance) });
  }
  return {
    accounts: [...by.entries()].map(([account, points]) => {
      const months = new Map();
      for (const p of points) months.set(p.date.slice(0, 7), p.balance); // last balance of each month
      return {
        account,
        points,
        latest: points[points.length - 1] ?? null,
        month_ends: [...months.entries()].map(([month, balance]) => ({ month, balance })),
      };
    }),
  };
}

/**
 * For the landing page: per account, the latest balance and how it moved since
 * 30 days before it and since the start of its year.
 */
export async function cashSummary(knex) {
  const { accounts } = await getBalances(knex);
  return accounts.map((a) => {
    const latest = a.latest;
    if (!latest) return { account: a.account, latest: null };
    const d30 = new Date(latest.date + 'T00:00:00Z');
    d30.setUTCDate(d30.getUTCDate() - 30);
    const ago30 = balanceOn(a.points, d30.toISOString().slice(0, 10));
    // the balance at the end of last year, or (when the history starts this year) the first one recorded this year
    const yearStart = balanceOn(a.points, `${Number(latest.date.slice(0, 4)) - 1}-12-31`) ?? a.points.find((p) => p.date.startsWith(latest.date.slice(0, 4))) ?? null;
    return {
      account: a.account,
      latest,
      change_30d: ago30 ? r2(latest.balance - ago30.balance) : null,
      change_ytd: yearStart ? r2(latest.balance - yearStart.balance) : null,
      month_ends: a.month_ends.slice(-12),
    };
  });
}
