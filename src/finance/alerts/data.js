// The numbers alerts watch and the sections a message can include. Uses the
// same logic as the dashboard (balances, metrics, attribution) so an alert and
// the page it points to always agree.
import { balanceOn, getBalances } from '../lib/balances.js';
import { classify, financeTotals, loadMetricsContext, spendingByGroup } from '../lib/metrics.js';
import { unattributedCount } from '../lib/attribution.js';
import { getProjectSpend } from '../services/attribution.js';
import { allocationsByTxn } from '../lib/allocations.js';
import { rentForMonth } from '../lib/rentMonth.js';
import { PERIODS } from './catalog.js';

const r2 = (n) => Math.round(Number(n) * 100) / 100;
export const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const shortDate = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Add days to a YYYY-MM-DD date. */
export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** [from, to] dates for a period ending on `today` (YYYY-MM-DD, the rule's local date). */
export function periodRange(period, today) {
  const d = new Date(today + 'T00:00:00Z');
  switch (period) {
    case 'today':
      return [today, today];
    case 'this_week':
      return [addDays(today, -d.getUTCDay()), today];
    case 'last_7_days':
      return [addDays(today, -6), today];
    case 'last_30_days':
      return [addDays(today, -29), today];
    case 'last_month': {
      const firstThis = `${today.slice(0, 7)}-01`;
      const last = addDays(firstThis, -1);
      return [`${last.slice(0, 7)}-01`, last];
    }
    case 'this_month':
    default:
      return [`${today.slice(0, 7)}-01`, today];
  }
}

async function txnsBetween(knex, from, to) {
  const rows = await knex('transactions').whereBetween('date', [from, to]).select('id', 'date', 'description', 'amount', 'category', 'source');
  return rows.map((r) => ({ ...r, date: ymd(r.date), amount: Number(r.amount) }));
}

/** Income / spending totals for a period, optionally one group or category. */
async function periodTotals(knex, { period, group, category }, today) {
  const [from, to] = periodRange(period, today);
  const ctx = await loadMetricsContext(knex);
  const rows = (await txnsBetween(knex, from, to)).filter(
    (r) => (!category || r.category === category) && (!group || ctx.groupOf(r.category) === group),
  );
  return { ...financeTotals(rows, ctx), from, to, rows, ctx };
}

/**
 * Spending (or income) per property: each transaction's spending / income
 * split by its allocations (a split counts its share on each property); what
 * isn't on a property goes to `null`. → [{ property_id, name, amount }],
 * largest first.
 */
export async function byProperty(knex, rows, ctx, kind) {
  const allocs = await allocationsByTxn(knex, rows.map((r) => r.id));
  const props = new Map((await knex('owned_properties').select('id', 'address')).map((p) => [Number(p.id), p.address]));
  const sums = new Map();
  const add = (pid, v) => sums.set(pid, (sums.get(pid) ?? 0) + v);
  for (const r of rows) {
    const c = classify(r, ctx);
    const part = kind === 'income' ? c.income : c.spending;
    if (!part) continue;
    const a = allocs.get(Number(r.id)) || [];
    let shared = 0;
    for (const x of a) {
      const share = r.amount ? x.amount / r.amount : 0;
      shared += share;
      add(x.property_id, part * share);
    }
    if (shared < 0.9999) add(null, part * (1 - shared));
  }
  return [...sums.entries()]
    .map(([pid, v]) => ({ property_id: pid, name: pid == null ? 'Not on a property' : props.get(pid) ?? `Property ${pid}`, amount: r2(v) }))
    .filter((x) => Math.abs(x.amount) >= 0.005)
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Evaluate a condition. → { value, triggered, detail, events? } where events
 * (for event metrics) is [{ key, line }], everything currently matching.
 */
export async function evaluateCondition(knex, c, today) {
  const cmp = (v) => (c.op === 'below' ? v < c.threshold : v > c.threshold);
  switch (c.metric) {
    case 'cash_total': {
      const { total } = await getBalances(knex);
      if (!total?.latest) return { value: null, triggered: false, detail: 'No bank balances uploaded yet.' };
      const v = total.latest.balance;
      return { value: v, triggered: cmp(v), detail: `Total cash is *${money(v)}* (as of ${shortDate(total.latest.date)}).` };
    }
    case 'account_balance': {
      const { accounts } = await getBalances(knex);
      const a = accounts.find((x) => x.account.toLowerCase() === c.account.toLowerCase());
      if (!a?.latest) return { value: null, triggered: false, detail: `No balances for an account named “${c.account}”.` };
      const v = a.latest.balance;
      return { value: v, triggered: cmp(v), detail: `${a.account} is *${money(v)}* (as of ${shortDate(a.latest.date)}).` };
    }
    case 'cash_change': {
      const { total } = await getBalances(knex);
      if (!total?.latest) return { value: null, triggered: false, detail: 'No bank balances uploaded yet.' };
      const then = balanceOn(total.points, addDays(total.latest.date, -c.days));
      if (!then) return { value: null, triggered: false, detail: `Not ${c.days} days of balance history yet.` };
      const v = r2(total.latest.balance - then.balance);
      return { value: v, triggered: cmp(v), detail: `Total cash changed *${v >= 0 ? '+' : ''}${money(v)}* over ${c.days} days (${money(then.balance)} → ${money(total.latest.balance)}).` };
    }
    case 'spending':
    case 'income': {
      const t = await periodTotals(knex, c, today);
      const per = PERIODS.find((p) => p.key === c.period)?.label ?? c.period;
      const scope = [c.group, c.category].filter(Boolean).join(' / ');
      const label = `${c.metric === 'spending' ? 'Spending' : 'Income'}${scope ? ` on ${scope}` : ''} ${per} (${shortDate(t.from)} – ${shortDate(t.to)})`;
      if (!c.property_id && !c.breakdown) {
        const v = c.metric === 'spending' ? t.spending : t.income;
        return { value: v, triggered: cmp(v), detail: `${label}: *${money(v)}*.` };
      }
      const split = await byProperty(knex, t.rows, t.ctx, c.metric);
      if (c.property_id) {
        const row = split.find((x) => x.property_id === c.property_id);
        const name = row?.name ?? (await knex('owned_properties').where({ id: c.property_id }).first('address'))?.address ?? `Property ${c.property_id}`;
        const v = row?.amount ?? 0;
        return { value: v, triggered: cmp(v), detail: `${label} at ${name}: *${money(v)}*.` };
      }
      const total = r2(split.reduce((s, x) => s + x.amount, 0));
      const each = c.threshold_scope === 'each';
      const hits = split.filter((x) => x.property_id != null && cmp(x.amount));
      const triggered = each ? hits.length > 0 : cmp(total);
      const lines = split.map((x) => `• ${x.name}: *${money(x.amount)}*${each && x.property_id != null && cmp(x.amount) ? ' ⚠️' : ''}`);
      return {
        value: each ? (hits[0]?.amount ?? 0) : total,
        triggered,
        detail: `${label}: *${money(total)}* in total${lines.length ? `, by property:\n${lines.join('\n')}` : ' (nothing yet)'}`,
      };
    }
    case 'needs_property': {
      const v = await unattributedCount(knex);
      return { value: v, triggered: cmp(v), detail: `*${v}* transaction${v === 1 ? '' : 's'} waiting for a property.` };
    }
    case 'large_transaction': {
      const ctx = await loadMetricsContext(knex);
      const rows = (await txnsBetween(knex, addDays(today, -60), addDays(today, 1))).filter((r) => {
        const dirOk = c.direction === 'any' ? true : c.direction === 'in' ? r.amount > 0 : r.amount < 0;
        return dirOk && Math.abs(r.amount) >= c.threshold && (!c.category || r.category === c.category) && (!c.group || ctx.groupOf(r.category) === c.group);
      });
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      return eventsResult(rows.map((r) => ({ key: `txn:${r.id}`, line: `${shortDate(r.date)} · ${r.description} · *${money(r.amount)}* (${r.category})` })), 'large transaction');
    }
    case 'rent_overdue': {
      const rows = await knex('rent_collections as rc')
        .leftJoin('units as u', 'u.id', 'rc.unit_id')
        .leftJoin('owned_properties as p', 'p.id', 'u.property_id')
        .whereNull('rc.paid_date')
        .where('rc.due_date', '<=', addDays(today, -c.days))
        .orderBy('rc.due_date')
        .select('rc.id', 'rc.due_date', 'rc.amount_due', 'u.unit_label', 'p.address');
      return eventsResult(rows.map((r) => ({ key: `rent:${r.id}`, line: `Unit ${r.unit_label ?? '?'}${r.address ? ` (${r.address})` : ''}: ${money(r.amount_due)} due ${shortDate(r.due_date)}, unpaid` })), 'unpaid rent');
    }
    case 'lease_expiring': {
      const rows = await knex('leases as l')
        .leftJoin('units as u', 'u.id', 'l.unit_id')
        .leftJoin('tenants as t', 't.id', 'l.tenant_id')
        .whereBetween('l.end_date', [today, addDays(today, c.days)])
        .orderBy('l.end_date')
        .select('l.id', 'l.end_date', 'u.unit_label', 't.first_name', 't.last_name');
      return eventsResult(rows.map((r) => ({ key: `lease:${r.id}:${r.end_date}`, line: `Unit ${r.unit_label ?? '?'}${r.first_name ? ` — ${r.first_name} ${r.last_name ?? ''}`.trimEnd() : ''}: lease ends ${shortDate(r.end_date)}` })), 'lease ending');
    }
    case 'insurance_expiring': {
      const rows = await knex('insurance_policies as i')
        .leftJoin('owned_properties as p', 'p.id', 'i.property_id')
        .whereBetween('i.expiration_date', [today, addDays(today, c.days)])
        .orderBy('i.expiration_date')
        .select('i.id', 'i.expiration_date', 'i.carrier', 'i.policy_type', 'p.address');
      return eventsResult(rows.map((r) => ({ key: `ins:${r.id}:${r.expiration_date}`, line: `${r.carrier}${r.policy_type ? ` ${r.policy_type}` : ''}${r.address ? ` (${r.address})` : ''}: expires ${shortDate(r.expiration_date)}` })), 'policy expiring');
    }
    case 'project_over_budget': {
      const projects = await projectBudgets(knex);
      const over = projects.filter((p) => p.quote > 0 && p.actual > p.quote * (1 + (c.percent ?? 0) / 100));
      return eventsResult(over.map((p) => ({ key: `proj:${p.id}`, line: `${p.name}${p.address ? ` (${p.address})` : ''}: spent ${money(p.actual)} vs. quote ${money(p.quote)} (+${Math.round(((p.actual - p.quote) / p.quote) * 100)}%)` })), 'project over budget');
    }
    default:
      return { value: null, triggered: false, detail: `Unknown metric ${c.metric}` };
  }
}

function eventsResult(events, noun) {
  return { value: events.length, triggered: events.length > 0, events, detail: `${events.length} ${noun}${events.length === 1 ? '' : 's'}` };
}

/** Projects with their quote (selected quote, else the project's own) and actual spend. */
async function projectBudgets(knex) {
  const [wos, quotes, spend] = await Promise.all([
    knex('work_orders as w').leftJoin('owned_properties as p', 'p.id', 'w.property_id').select('w.id', 'w.project_name', 'w.description', 'w.status', 'w.quoted_cost', 'p.address'),
    knex('project_quotes').where('is_selected', true).select('work_order_id', 'quoted_cost', 'final_cost'),
    getProjectSpend(knex, {}),
  ]);
  const sel = new Map(quotes.map((q) => [Number(q.work_order_id), q]));
  return wos.map((w) => {
    const q = sel.get(Number(w.id));
    const quote = Number(q?.quoted_cost ?? w.quoted_cost ?? 0) || 0;
    return {
      id: w.id,
      name: w.project_name || w.description || `Project #${w.id}`,
      status: w.status,
      address: w.address,
      quote,
      actual: spend.projects[w.id]?.actual_spend ?? 0,
      txns: spend.projects[w.id]?.transaction_count ?? 0,
    };
  });
}

/** One message section as Slack text (title + lines). Missing data reads as a short note. */
export async function buildSection(knex, key, today) {
  try {
    switch (key) {
      case 'cash_position': {
        const { accounts, total } = await getBalances(knex);
        if (!total?.latest) return section('Cash position', ['No bank balances uploaded yet.']);
        const ago = balanceOn(total.points, addDays(total.latest.date, -30));
        const lines = [`Total *${money(total.latest.balance)}* (as of ${shortDate(total.latest.date)})${ago ? ` · 30-day change ${total.latest.balance - ago.balance >= 0 ? '+' : ''}${money(r2(total.latest.balance - ago.balance))}` : ''}`];
        for (const a of accounts) if (a.latest) lines.push(`${a.account}: ${money(a.latest.balance)}`);
        return section('Cash position', lines);
      }
      case 'month_to_date': {
        const t = await periodTotals(knex, { period: 'this_month' }, today);
        return section('This month so far', [`Income ${money(t.income)} · Spending ${money(t.spending)} · Cash flow ${t.cash_flow >= 0 ? '+' : ''}${money(t.cash_flow)}`]);
      }
      case 'spending_by_group': {
        const [from, to] = periodRange('this_month', today);
        const ctx = await loadMetricsContext(knex);
        const rows = (await txnsBetween(knex, from, to)).map((r) => ({ ...r, group: ctx.groupOf(r.category) }));
        const top = spendingByGroup(rows, ctx, 8);
        return section('Spending by group this month', top.length ? top.map((g) => `${g.group ?? g.name ?? g.key}: ${money(g.spending ?? g.total ?? g.amount)}`) : ['Nothing yet this month.']);
      }
      case 'spending_by_property': {
        const t = await periodTotals(knex, { period: 'this_month' }, today);
        const split = await byProperty(knex, t.rows, t.ctx, 'spending');
        return section('Spending by property this month', split.length ? split.map((x) => `${x.name}: ${money(x.amount)}`) : ['Nothing yet this month.']);
      }
      case 'top_transactions': {
        const rows = (await txnsBetween(knex, addDays(today, -6), today)).filter((r) => r.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 5);
        return section('Largest transactions (last 7 days)', rows.length ? rows.map((r) => `${shortDate(r.date)} · ${r.description} · ${money(r.amount)}`) : ['None.']);
      }
      case 'recent_transactions': {
        const rows = await knex('transactions').orderBy('date', 'desc').orderBy('id', 'desc').limit(8).select('date', 'description', 'amount');
        return section('Latest transactions', rows.length ? rows.map((r) => `${shortDate(ymd(r.date))} · ${r.description} · ${money(r.amount)}`) : ['None yet.']);
      }
      case 'needs_property': {
        const n = await unattributedCount(knex);
        return section('Needs a property', [n ? `${n} transaction${n === 1 ? '' : 's'} waiting for a property.` : 'All caught up.']);
      }
      case 'open_projects': {
        const ps = (await projectBudgets(knex)).filter((p) => p.status !== 'completed');
        return section('Open projects', ps.length ? ps.map((p) => `${p.name}: quote ${p.quote ? money(p.quote) : '—'} · actual ${money(p.actual)}${p.quote && p.actual > p.quote ? ' ⚠️ over' : ''}`) : ['No open projects.']);
      }
      case 'rent_status': {
        // Same rule as the Overview (lib/rentMonth.js): due from the lease, every payment added up.
        const from = `${today.slice(0, 7)}-01`;
        const to = `${today.slice(0, 7)}-31`; // compared as text, so -31 covers every month
        const [units, leases, rows, tenants] = await Promise.all([
          knex('units').select('id', 'unit_label', 'is_owner_unit').orderBy('unit_label'),
          knex('leases').select('unit_id', 'start_date', 'end_date', 'rent_amount'),
          knex('rent_collections').whereBetween('due_date', [from, to]).select('unit_id', 'due_date', 'amount_due', 'amount_paid'),
          knex('tenants').where({ is_active: true }).select('unit_id'),
        ]);
        const rental = units.filter((u) => !u.is_owner_unit);
        const byUnit = rentForMonth({ unitIds: rental.map((u) => Number(u.id)), leases, rows, start: from, end: to, occupied: new Set(tenants.map((t) => Number(t.unit_id))) });
        const lines = rental
          .map((u) => ({ u, r: byUnit.get(Number(u.id)) }))
          .filter(({ r }) => r && r.due > 0)
          .map(({ u, r }) => `Unit ${u.unit_label}: ${r.status === 'paid' ? `paid ${money(r.collected)}${r.payments > 1 ? ` (${r.payments} payments)` : ''}` : r.collected > 0 ? `*partial* ${money(r.collected)} of ${money(r.due)}` : `*unpaid* (${money(r.due)} due)`}`);
        return section('Rent this month', lines.length ? lines : ['No rent due this month.']);
      }
      case 'upcoming_expirations': {
        const leases = await evaluateCondition(knex, { metric: 'lease_expiring', days: 60 }, today);
        const ins = await evaluateCondition(knex, { metric: 'insurance_expiring', days: 60 }, today);
        const lines = [...leases.events, ...ins.events].map((e) => e.line);
        return section('Ending in the next 60 days', lines.length ? lines : ['Nothing.']);
      }
      case 'recurring_costs': {
        const rows = await knex('recurring_costs').where('is_active', true).select('description', 'monthly_amount', 'frequency', 'amount', 'start_date', 'end_date');
        const live = rows.filter((r) => (!r.start_date || r.start_date <= today) && (!r.end_date || r.end_date >= today));
        const total = live.reduce((s, r) => s + Number(r.monthly_amount), 0);
        return section('Recurring costs', live.length ? [`${money(total)} / month in total`, ...live.map((r) => `${r.description}: ${money(Number(r.amount ?? r.monthly_amount))} / ${r.frequency === 'yearly' ? 'year' : 'month'}`)] : ['None running.']);
      }
      default:
        return section(key, ['Unknown section.']);
    }
  } catch (e) {
    return section(key.replace(/_/g, ' '), [`Couldn’t load this: ${e.message}`]);
  }
}

function section(title, lines) {
  return `*${title}*\n${lines.map((l) => `• ${l}`).join('\n')}`;
}
