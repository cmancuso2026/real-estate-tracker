// The numbers alerts watch and the sections a message can include. Uses the
// same logic as the dashboard (balances, metrics, attribution) so an alert and
// the page it points to always agree.
import { balanceOn, getBalances } from '../lib/balances.js';
import { financeTotals, loadMetricsContext, spendingByGroup } from '../lib/metrics.js';
import { unattributedCount } from '../lib/attribution.js';
import { getProjectSpend } from '../services/attribution.js';
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
  return { ...financeTotals(rows, ctx), from, to };
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
      const v = c.metric === 'spending' ? t.spending : t.income;
      const per = PERIODS.find((p) => p.key === c.period)?.label ?? c.period;
      const scope = [c.group, c.category].filter(Boolean).join(' / ');
      return { value: v, triggered: cmp(v), detail: `${c.metric === 'spending' ? 'Spending' : 'Income'}${scope ? ` on ${scope}` : ''} ${per}: *${money(v)}*.` };
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
        const month = today.slice(0, 7);
        const rows = await knex('rent_collections as rc')
          .leftJoin('units as u', 'u.id', 'rc.unit_id')
          .whereBetween('rc.due_date', [`${month}-01`, `${month}-31`])
          .orderBy('u.unit_label')
          .select('u.unit_label', 'rc.amount_due', 'rc.amount_paid', 'rc.paid_date');
        if (!rows.length) return section('Rent this month', ['No rent recorded for this month yet.']);
        return section('Rent this month', rows.map((r) => `Unit ${r.unit_label}: ${r.paid_date ? `paid ${money(r.amount_paid ?? r.amount_due)} on ${shortDate(r.paid_date)}` : `*unpaid* (${money(r.amount_due)} due)`}`));
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
