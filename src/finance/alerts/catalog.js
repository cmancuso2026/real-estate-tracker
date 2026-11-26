// What an alert can watch, how often it runs, and what a message can include.
// Plain JS with no server dependencies: the Admin page imports it to build its
// form, the interpreter turns plain English into these shapes, and the engine
// evaluates them. Every rule is validated with normalizeRule() before saving.

export const CADENCES = [
  { key: 'realtime', label: 'Real time', help: 'Checked every few minutes and right after uploads; sent as soon as it happens.' },
  { key: 'daily', label: 'Daily', help: 'Once a day at the time you pick.' },
  { key: 'weekly', label: 'Weekly', help: 'Once a week on the day and time you pick.' },
  { key: 'monthly', label: 'Monthly', help: 'Once a month on the day and time you pick.' },
];

export const PERIODS = [
  { key: 'today', label: 'today' },
  { key: 'this_week', label: 'this week' },
  { key: 'this_month', label: 'this month' },
  { key: 'last_7_days', label: 'the last 7 days' },
  { key: 'last_30_days', label: 'the last 30 days' },
  { key: 'last_month', label: 'last month' },
];

/**
 * Metrics an alert condition can watch.
 * - level: a number compared with a threshold (op below / above). Real time
 *   sends when it crosses (false → true), then waits until it clears.
 * - event: a list of things (a large transaction, an expiring lease); each is
 *   sent once. `baseline: true` means things that already exist when the alert
 *   is created are not sent (only new ones).
 * `params` lists the extra fields the metric takes.
 */
export const METRICS = [
  { key: 'cash_total', type: 'level', label: 'Total cash position', unit: '$', params: [], example: 'cash position drops below $30,000' },
  { key: 'account_balance', type: 'level', label: 'One account’s balance', unit: '$', params: ['account'], example: 'Checking drops below $2,000' },
  { key: 'cash_change', type: 'level', label: 'Change in total cash over N days', unit: '$', params: ['days'], example: 'cash falls by more than $5,000 in 7 days (op below, threshold -5000)' },
  { key: 'spending', type: 'level', label: 'Spending in a period', unit: '$', params: ['period', 'group', 'category', 'property', 'breakdown'], example: 'spending this month goes over $8,000; repair spend by property last month over $2,000 (category Repairs, breakdown property)' },
  { key: 'income', type: 'level', label: 'Income in a period', unit: '$', params: ['period', 'group', 'category', 'property', 'breakdown'], example: 'income this month is under $10,000' },
  { key: 'needs_property', type: 'level', label: 'Transactions waiting for a property', unit: 'count', params: [], example: 'more than 10 transactions need a property' },
  { key: 'large_transaction', type: 'event', baseline: true, label: 'A single large transaction', unit: '$', params: ['direction', 'group', 'category'], example: 'any charge over $1,000' },
  { key: 'rent_overdue', type: 'event', label: 'Rent unpaid N days after it was due', unit: 'days', params: ['days'], example: 'rent is 5 days late' },
  { key: 'lease_expiring', type: 'event', label: 'A lease ending within N days', unit: 'days', params: ['days'], example: 'a lease ends in the next 60 days' },
  { key: 'insurance_expiring', type: 'event', label: 'An insurance policy expiring within N days', unit: 'days', params: ['days'], example: 'a policy expires within 30 days' },
  { key: 'project_over_budget', type: 'event', label: 'A project’s actual spend over its quote', unit: '%', params: ['percent'], example: 'a project goes 10% over its quote' },
];

/** Sections a message can include (a summary is made of these; any alert can add them). */
export const SECTIONS = [
  { key: 'cash_position', label: 'Cash position (total and each account)' },
  { key: 'month_to_date', label: 'Income and spending this month' },
  { key: 'spending_by_group', label: 'Spending by group this month' },
  { key: 'spending_by_property', label: 'Spending by property this month' },
  { key: 'top_transactions', label: 'Largest transactions (last 7 days)' },
  { key: 'recent_transactions', label: 'Latest transactions' },
  { key: 'needs_property', label: 'Transactions waiting for a property' },
  { key: 'open_projects', label: 'Open projects: quote vs. actual' },
  { key: 'rent_status', label: 'Rent this month: paid / unpaid' },
  { key: 'upcoming_expirations', label: 'Leases and insurance ending in 60 days' },
  { key: 'recurring_costs', label: 'Recurring costs' },
];

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DEFAULT_TIMEZONE = 'America/New_York';

const METRIC_KEYS = METRICS.map((m) => m.key);
const SECTION_KEYS = SECTIONS.map((s) => s.key);
const PERIOD_KEYS = PERIODS.map((p) => p.key);

function bad(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}
const num = (v) => (v === '' || v == null ? null : Number(v));

/** The default parameter values a metric uses when a rule leaves them out. */
export function metricDefaults(key) {
  return {
    cash_change: { days: 7 },
    spending: { period: 'this_month' },
    income: { period: 'this_month' },
    large_transaction: { direction: 'out' },
    rent_overdue: { days: 3 },
    lease_expiring: { days: 60 },
    insurance_expiring: { days: 30 },
    project_over_budget: { percent: 0 },
  }[key] ?? {};
}

/** Check a condition and fill in defaults. Throws a 400 with a readable message. */
export function normalizeCondition(c) {
  if (!c || typeof c !== 'object') throw bad('Pick what the alert should watch');
  const m = METRICS.find((x) => x.key === c.metric);
  if (!m) throw bad(`Unknown metric. Expected one of: ${METRIC_KEYS.join(', ')}`);
  const out = { metric: m.key, ...metricDefaults(m.key) };
  if (m.type === 'level') {
    if (c.op !== 'below' && c.op !== 'above') throw bad('Pick "below" or "above"');
    const t = num(c.threshold);
    if (t == null || !Number.isFinite(t)) throw bad('Enter a threshold');
    out.op = c.op;
    out.threshold = t;
  }
  if (m.key === 'large_transaction') {
    const t = num(c.threshold);
    if (t == null || !Number.isFinite(t) || t <= 0) throw bad('Enter the smallest amount that counts as large');
    out.threshold = t;
    if (c.direction) {
      if (!['out', 'in', 'any'].includes(c.direction)) throw bad('direction must be out, in or any');
      out.direction = c.direction;
    }
  }
  if (m.params.includes('account')) {
    if (!c.account || !String(c.account).trim()) throw bad('Pick the account');
    out.account = String(c.account).trim();
  }
  if (m.params.includes('days') && c.days != null && c.days !== '') {
    const d = Number(c.days);
    if (!Number.isInteger(d) || d < 0 || d > 3650) throw bad('days must be a whole number of days');
    out.days = d;
  }
  if (m.params.includes('percent') && c.percent != null && c.percent !== '') {
    const p = Number(c.percent);
    if (!Number.isFinite(p) || p < 0) throw bad('percent must be 0 or more');
    out.percent = p;
  }
  if (m.params.includes('period') && c.period) {
    if (!PERIOD_KEYS.includes(c.period)) throw bad(`period must be one of: ${PERIOD_KEYS.join(', ')}`);
    out.period = c.period;
  }
  if (m.params.includes('group') && c.group) out.group = String(c.group);
  if (m.params.includes('category') && c.category) out.category = String(c.category);
  if (m.params.includes('property') && c.property_id != null && c.property_id !== '') {
    const id = Number(c.property_id);
    if (!Number.isInteger(id) || id <= 0) throw bad('Pick a property');
    out.property_id = id;
  }
  // breakdown 'property': list each property's share in the message, and
  // threshold_scope says whether the line is for the total or any one property.
  if (m.params.includes('breakdown') && c.breakdown) {
    if (c.breakdown !== 'property') throw bad('breakdown must be "property"');
    out.breakdown = 'property';
    const scope = c.threshold_scope ?? 'total';
    if (scope !== 'total' && scope !== 'each') throw bad('threshold_scope must be total or each');
    out.threshold_scope = scope;
  }
  return out;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate a whole rule from the Admin form / interpreter and return the
 * columns to save. Throws 400s with readable messages.
 */
export function normalizeRule(b = {}) {
  const name = String(b.name ?? '').trim();
  if (!name) throw bad('Give the alert a name');
  const kind = b.kind === 'summary' ? 'summary' : 'condition';
  const cadence = CADENCES.some((c) => c.key === b.cadence) ? b.cadence : null;
  if (!cadence) throw bad('Pick how often: real time, daily, weekly or monthly');
  if (kind === 'summary' && cadence === 'realtime') throw bad('A summary goes out on a schedule: pick daily, weekly or monthly');
  const send_time = b.send_time ? String(b.send_time) : '08:00';
  if (!HHMM.test(send_time)) throw bad('Time must look like 08:00');
  const weekday = cadence === 'weekly' ? Number(b.weekday ?? 1) : null;
  if (cadence === 'weekly' && !(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw bad('Pick a day of the week');
  const month_day = cadence === 'monthly' ? Number(b.month_day ?? 1) : null;
  if (cadence === 'monthly' && !(Number.isInteger(month_day) && month_day >= 1 && month_day <= 28)) throw bad('Pick a day of the month from 1 to 28');
  const include = [...new Set((Array.isArray(b.include) ? b.include : []).map(String))];
  const unknown = include.filter((k) => !SECTION_KEYS.includes(k));
  if (unknown.length) throw bad(`Unknown section: ${unknown.join(', ')}`);
  if (kind === 'summary' && !include.length) throw bad('Pick at least one thing for the summary to include');
  const condition = kind === 'condition' ? normalizeCondition(b.condition) : null;
  const timezone = b.timezone ? String(b.timezone) : DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw bad(`Unknown time zone: ${timezone}`);
  }
  return {
    name: name.slice(0, 120),
    prompt: b.prompt ? String(b.prompt).slice(0, 2000) : null,
    enabled: b.enabled === undefined ? true : !!b.enabled,
    kind,
    cadence,
    send_time,
    weekday,
    month_day,
    timezone,
    condition_json: condition ? JSON.stringify(condition) : null,
    include_json: JSON.stringify(include),
    message: b.message ? String(b.message).slice(0, 1000) : null,
    channel_id: b.channel_id == null || b.channel_id === '' ? null : Number(b.channel_id),
  };
}

const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** "Total cash position drops below $30,000" — a one-line description of a condition. */
export function describeCondition(c) {
  if (!c) return '';
  const m = METRICS.find((x) => x.key === c.metric);
  if (!m) return c.metric;
  const per = PERIODS.find((p) => p.key === c.period)?.label;
  const scope = [c.group, c.category].filter(Boolean).join(' / ');
  const cmp = (v) => `${c.op === 'below' ? 'drops below' : 'goes above'} ${v}`;
  switch (c.metric) {
    case 'cash_total':
      return `Total cash ${cmp(money(c.threshold))}`;
    case 'account_balance':
      return `${c.account} balance ${cmp(money(c.threshold))}`;
    case 'cash_change':
      return `Change in total cash over ${c.days} days ${cmp(money(c.threshold))}`;
    case 'spending':
    case 'income': {
      const what = `${c.metric === 'spending' ? 'Spending' : 'Income'}${scope ? ` on ${scope}` : ''}`;
      const where = c.property_name ? ` at ${c.property_name}` : c.property_id ? ' at one property' : '';
      const cmp = `${c.op === 'below' ? 'is under' : 'goes over'} ${money(c.threshold)}`;
      if (c.breakdown === 'property') {
        return c.threshold_scope === 'each'
          ? `${what} ${per}, by property: any property ${cmp}`
          : `${what}${where} ${per} ${cmp} in total (shown by property)`;
      }
      return `${what}${where} ${per} ${cmp}`;
    }
    case 'needs_property':
      return `More than ${c.threshold} transactions waiting for a property`.replace('More than', c.op === 'below' ? 'Fewer than' : 'More than');
    case 'large_transaction':
      return `Any ${c.direction === 'in' ? 'deposit' : c.direction === 'any' ? 'transaction' : 'charge'} of ${money(c.threshold)} or more${scope ? ` on ${scope}` : ''}`;
    case 'rent_overdue':
      return `Rent unpaid ${c.days} days after it was due`;
    case 'lease_expiring':
      return `A lease ends within ${c.days} days`;
    case 'insurance_expiring':
      return `An insurance policy expires within ${c.days} days`;
    case 'project_over_budget':
      return `A project’s actual spend goes ${c.percent ? `${c.percent}% ` : ''}over its quote`;
    default:
      return m.label;
  }
}

/** "Daily at 08:00", "Weekly on Monday at 08:00", "Real time". */
export function describeSchedule(r) {
  if (r.cadence === 'realtime') return 'Real time';
  if (r.cadence === 'daily') return `Daily at ${r.send_time}`;
  if (r.cadence === 'weekly') return `Weekly on ${WEEKDAYS[r.weekday ?? 1]} at ${r.send_time}`;
  return `Monthly on day ${r.month_day ?? 1} at ${r.send_time}`;
}
