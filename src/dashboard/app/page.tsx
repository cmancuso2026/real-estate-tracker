import Link from 'next/link';
import { getOverview } from '@finance/services/overview.js';
import { financeDb } from '@/lib/finance';
import { InfoTip } from '@/components/finance/InfoTip';

export const dynamic = 'force-dynamic';

type Overview = Awaited<ReturnType<typeof getOverview>>;
type Flow = { rent: number; piti: number; expenses: number; net: number; count: number };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function money(n: number, cents = true) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (n < 0 ? '-$' : '$') + s;
}
const signed = (n: number) => (n > 0 ? '+' : '') + money(n);
const tone = (n: number) => (Math.abs(n) < 0.005 ? 'text-gray-400' : n > 0 ? 'text-green-700' : 'text-red-600');
const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);
function monthLabel(ym: string) {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shortDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Card({ children, className = '', testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div data-testid={testId} className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-500">{children}</div>;
}
function SectionHead({ title, href, cta }: { title: string; href: string; cta: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Link href={href} className="text-sm font-medium text-blue-600 hover:underline">
        {cta} →
      </Link>
    </div>
  );
}
function FlowCell({ f, testId }: { f: Flow; testId: string }) {
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right align-top">
      <div className={`font-semibold tabular ${tone(f.net)}`} data-testid={testId}>
        {f.count ? signed(f.net) : '—'}
      </div>
      {f.count > 0 && (
        <div className="text-[11px] tabular text-gray-400">
          rent {money(f.rent, false)} · PITI {money(f.piti, false)} · exp {money(f.expenses, false)}
        </div>
      )}
    </td>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  let o: Overview;
  try {
    o = await getOverview(financeDb(), { month });
  } catch (err) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Couldn&apos;t load the overview: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }
  const f = o.finance;
  const re = o.real_estate;
  const isCurrent = o.month === o.today.slice(0, 7);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-gray-500">
            {monthLabel(o.month)} · year to date from Jan 1, {o.month.slice(0, 4)}
          </p>
        </div>
        <nav className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-sm" aria-label="Month">
          <Link href={`/?month=${shiftMonth(o.month, -1)}`} className="rounded-md px-2.5 py-1 text-gray-600 hover:bg-gray-100">
            ← {monthLabel(shiftMonth(o.month, -1)).split(' ')[0]}
          </Link>
          <span className="px-2 font-medium" data-testid="overview-month">
            {monthLabel(o.month)}
          </span>
          {!isCurrent && (
            <Link href={`/?month=${shiftMonth(o.month, 1)}`} className="rounded-md px-2.5 py-1 text-gray-600 hover:bg-gray-100">
              {monthLabel(shiftMonth(o.month, 1)).split(' ')[0]} →
            </Link>
          )}
        </nav>
      </div>

      {(o.attribution.unattributed > 0 || o.mappings.unconfirmed > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {o.attribution.unattributed > 0 && (
            <Link
              href="/finance/attribution"
              data-testid="overview-attribution"
              className="flex items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm hover:bg-orange-100"
            >
              <span>
                <strong className="text-orange-800">
                  {o.attribution.unattributed} transaction{o.attribution.unattributed === 1 ? '' : 's'} need a property
                </strong>
                <span className="block text-orange-900/70">Property cash flow below leaves them out until they&apos;re assigned.</span>
              </span>
              <span className="shrink-0 font-medium text-orange-800">Review →</span>
            </Link>
          )}
          {o.mappings.unconfirmed > 0 && (
            <Link href="/admin/property-mapping" className="block rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm hover:bg-blue-100" data-testid="overview-mappings">
              <strong className="text-blue-900">
                {o.mappings.unconfirmed} of {o.mappings.total} property category mappings are unconfirmed.
              </strong>
              <span className="block text-blue-900/70">
                Rent and PITI categories were matched to properties by street number. Review and confirm them in Admin →
              </span>
            </Link>
          )}
        </div>
      )}

      {/* ── Personal finance ── */}
      <section className="space-y-3">
        <SectionHead title="Personal finance" href="/finance" cta="Open Finances" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(
            [
              ['Income', 'income', f.month.income, f.ytd.income, 'text-green-700'],
              ['Spending', 'spending', -f.month.spending, -f.ytd.spending, 'text-red-600'],
              ['Cash flow', 'cashflow', f.month.cash_flow, f.ytd.cash_flow, ''],
            ] as const
          ).map(([label, key, m, y, cls]) => (
            <Card key={key}>
              <Label>
                {label}
                <InfoTip text={f.definitions[key === 'cashflow' ? 'cash_flow' : key]} testId={`def-${key}`} />
              </Label>
              <div className={`mt-1 text-3xl font-bold tabular ${cls || tone(m)}`} data-testid={`fin-${key}-month`}>
                {money(m)}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                YTD{' '}
                <span className={`font-medium tabular ${cls || tone(y)}`} data-testid={`fin-${key}-ytd`}>
                  {money(y)}
                </span>
              </div>
            </Card>
          ))}
        </div>
        <CashCard cash={f.cash} monthName={monthLabel(o.month)} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <Label>Top spending groups</Label>
            <table className="mt-2 w-full text-sm" data-testid="top-groups">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left font-normal">Group</th>
                  <th className="text-right font-normal">This month</th>
                  <th className="text-right font-normal">YTD</th>
                </tr>
              </thead>
              <tbody>
                {f.top_groups.ytd.map((g) => (
                  <tr key={g.group} className="border-t border-gray-100">
                    <td className="py-1.5">{g.group}</td>
                    <td className="py-1.5 text-right tabular text-gray-700">
                      {money(f.top_groups.month.find((x) => x.group === g.group)?.spending ?? 0)}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular">{money(g.spending)}</td>
                  </tr>
                ))}
                {f.top_groups.ytd.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-center text-gray-400">
                      No spending yet this year.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
          <Card>
            <div className="flex items-baseline justify-between">
              <Label>Latest uploads by source</Label>
              <Link href="/upload" className="text-xs text-blue-600 hover:underline">
                Upload
              </Link>
            </div>
            <table className="mt-2 w-full text-sm" data-testid="latest-uploads">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="text-left font-normal">Source</th>
                  <th className="text-left font-normal">Data through</th>
                  <th className="text-left font-normal">Last file</th>
                </tr>
              </thead>
              <tbody>
                {f.latest_uploads.map((u) => (
                  <tr key={u.source} className="border-t border-gray-100">
                    <td className="py-1.5">{u.source}</td>
                    <td className="py-1.5 tabular">{u.data_through ? shortDate(u.data_through) : '—'}</td>
                    <td className="max-w-[12rem] truncate py-1.5 text-xs text-gray-500" title={u.last_upload?.filename ?? ''}>
                      {u.last_upload ? `${u.last_upload.filename} (+${u.last_upload.new_rows})` : 'imported earlier'}
                    </td>
                  </tr>
                ))}
                {f.latest_uploads.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-center text-gray-400">
                      No statements uploaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* ── Real estate ── */}
      <section className="space-y-3">
        <SectionHead title="Real estate" href="/properties" cta="My Properties" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <Label>Units rented</Label>
            <div className="mt-1 text-3xl font-bold tabular" data-testid="re-units-rented">
              {re.occupied_units}/{re.rental_units}
            </div>
            <div className="mt-1 text-xs text-gray-500" data-testid="re-properties">
              across {re.properties} {re.properties === 1 ? 'property' : 'properties'}
              {re.units > re.rental_units && ` · ${re.units - re.rental_units} unit${re.units - re.rental_units === 1 ? '' : 's'} you live in`}
            </div>
          </Card>
          <Card>
            <Label>Occupancy</Label>
            <div className="mt-1 text-3xl font-bold tabular" data-testid="re-occupancy">
              {pct(re.occupancy)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {re.rental_units - re.occupied_units === 0
                ? 'every rental unit has a tenant'
                : `${re.rental_units - re.occupied_units} vacant unit${re.rental_units - re.occupied_units === 1 ? '' : 's'}`}
            </div>
          </Card>
          <Card>
            <Label>PITI {isCurrent ? 'this month' : `in ${monthLabel(o.month).split(' ')[0]}`}</Label>
            <div className="mt-1 text-3xl font-bold tabular" data-testid="re-piti">
              {money(re.piti_this_month.total, false)}
            </div>
            <div className="mt-1 text-xs text-gray-500" data-testid="re-piti-split">
              {re.piti_this_month.by_property.map((p) => `${p.address.split(' ')[0]} ${money(p.amount, false)}`).join(' · ')}
            </div>
            <div className="mt-0.5 text-[11px] text-gray-400">YTD {money(re.piti_this_month.ytd, false)}</div>
          </Card>
          <Card>
            <Label>Rent {isCurrent ? 'this month' : `in ${monthLabel(o.month).split(' ')[0]}`}</Label>
            <div className="mt-1 text-3xl font-bold tabular text-green-700" data-testid="re-collected">
              {money(re.rent_this_month.collected, false)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              of {money(re.rent_this_month.due, false)} due ·{' '}
              <span className={re.rent_this_month.outstanding > 0 ? 'font-medium text-red-600' : ''} data-testid="re-outstanding">
                {money(re.rent_this_month.outstanding, false)} outstanding
              </span>
            </div>
            {re.rent_this_month.due > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-gray-100">
                <div
                  className="h-full rounded bg-green-500"
                  style={{ width: `${Math.min(100, (re.rent_this_month.collected / re.rent_this_month.due) * 100)}%` }}
                />
              </div>
            )}
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card testId="re-leases">
            <Label>Leases ending in the next 60 days ({re.expiring_leases.length})</Label>
            <ul className="mt-2 space-y-1.5 text-sm">
              {re.expiring_leases.map((l) => (
                <li key={`${l.property_id}-${l.unit_label}`} className="flex justify-between gap-3">
                  <Link href={`/properties/${l.property_id}?tab=leases`} className="truncate hover:underline">
                    {l.address} · Unit {l.unit_label} · {l.tenant}
                  </Link>
                  <span className="shrink-0 tabular text-orange-700">{shortDate(l.end_date)}</span>
                </li>
              ))}
              {re.expiring_leases.length === 0 && <li className="text-gray-400">None</li>}
            </ul>
          </Card>
          <Card testId="re-policies">
            <Label>Insurance expiring in the next 60 days ({re.expiring_policies.length})</Label>
            <ul className="mt-2 space-y-1.5 text-sm">
              {re.expiring_policies.map((p, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <Link href={`/properties/${p.property_id}?tab=insurance`} className="truncate hover:underline">
                    {p.address} · {p.carrier}
                    {p.policy_type ? ` (${p.policy_type})` : ''}
                  </Link>
                  <span className="shrink-0 tabular text-orange-700">{shortDate(p.expiration_date)}</span>
                </li>
              ))}
              {re.expiring_policies.length === 0 && <li className="text-gray-400">None</li>}
            </ul>
          </Card>
        </div>
      </section>

      {/* ── Properties ── */}
      <section className="space-y-3">
        <SectionHead title="Properties" href="/properties" cta="All properties" />
        <Card className="overflow-x-auto p-0">
          <table className="min-w-full text-sm" data-testid="properties-table">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 text-left font-medium">Property</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-right font-medium">Occupancy</th>
                <th className="px-3 py-2 text-right font-medium">Scheduled rent</th>
                <th className="px-3 py-2 text-right font-medium">Collected {isCurrent ? 'this month' : monthLabel(o.month).split(' ')[0]}</th>
                <th className="px-3 py-2 text-right font-medium">Cash flow · {monthLabel(o.month).split(' ')[0]}</th>
                <th className="px-3 py-2 text-right font-medium">Cash flow · YTD</th>
              </tr>
            </thead>
            <tbody>
              {o.properties.map((p) => (
                <tr key={p.id} className="border-t border-gray-100" data-testid={`property-row-${p.id}`}>
                  <td className="px-3 py-2 align-top">
                    <Link href={`/properties/${p.id}`} className="font-medium hover:underline">
                      {p.address}
                    </Link>
                    <div className="text-[11px] text-gray-400">
                      {p.mapped_categories.length ? (
                        <>
                          {p.mapped_categories.join(', ')} ·{' '}
                          <Link href={`/properties/${p.id}?tab=spend`} className="text-blue-600 hover:underline">
                            repairs &amp; spend
                          </Link>
                        </>
                      ) : (
                        'No rent or PITI categories mapped'
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular">
                    {p.rental_units}
                    {p.units !== p.rental_units && <span className="text-gray-400"> / {p.units}</span>}
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular">
                    {pct(p.occupancy)}
                    <div className="text-[11px] text-gray-400">
                      {p.occupied_units}/{p.rental_units}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular">{money(p.scheduled_rent, false)}</td>
                  <td className="px-3 py-2 text-right align-top tabular">
                    {money(p.rent_collected, false)}
                    {p.rent_due > 0 && <div className="text-[11px] text-gray-400">of {money(p.rent_due, false)}</div>}
                  </td>
                  <FlowCell f={p.cash_flow.month as Flow} testId={`flow-month-${p.id}`} />
                  <FlowCell f={p.cash_flow.ytd as Flow} testId={`flow-ytd-${p.id}`} />
                </tr>
              ))}
              {o.properties.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                    No properties yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
            Cash flow = rent categories mapped to the property − PITI categories mapped to it − expenses assigned to it (Repairs, Lawn Care,
            Home Depot…), from your finance transactions.
          </p>
        </Card>
      </section>
    </div>
  );
}

type Cash = {
  latest: { date: string; balance: number } | null;
  before_history?: string;
  change_30d: number | null;
  change_ytd: number | null;
  month_ends: { month: string; balance: number }[];
  accounts: { account: string; latest: { date: string; balance: number } | null }[];
} | null;

/** Cash position: total cash now (checking + savings), how it moved, and a 12-month trend (month-end balances). */
function CashCard({ cash, monthName }: { cash: Cash; monthName: string }) {
  const usd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  const signed = (n: number | null | undefined) =>
    n == null ? '—' : <span className={n >= 0 ? 'text-green-700' : 'text-red-600'}>{(n >= 0 ? '+' : '') + usd(n)}</span>;
  if (!cash) {
    return (
      <Card>
        <Label>Cash position</Label>
        <p className="mt-1 text-sm text-gray-500">
          Upload Bank of America checking and savings statements to track your cash over time.{' '}
          <Link href="/upload?kind=statements" className="text-blue-600 hover:underline">
            Upload →
          </Link>
        </p>
      </Card>
    );
  }
  if (!cash.latest) {
    return (
      <Card>
        <Label>Cash position</Label>
        <p className="mt-1 text-sm text-gray-500">No balances recorded by the end of {monthName}; your statement history starts {cash.before_history}.</p>
      </Card>
    );
  }
  const latest = cash.latest;
  const pts = cash.month_ends ?? [];
  const min = Math.min(...pts.map((p) => p.balance));
  const max = Math.max(...pts.map((p) => p.balance));
  const W = 240;
  const H = 48;
  const path = pts
    .map((p, i) => {
      const x = pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W;
      const y = max === min ? H / 2 : H - ((p.balance - min) / (max - min)) * (H - 4) - 2;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4" data-testid="cash-card">
        <div>
          <Label>Cash position{cash.accounts.length > 1 ? ' · total' : ''}</Label>
          <div className="mt-1 text-3xl font-bold tabular" data-testid="cash-total">{usd(latest.balance)}</div>
          <div className="mt-1 text-xs text-gray-500">
            as of {latest.date} · 30 days before {signed(cash.change_30d)} · since Jan 1 {signed(cash.change_ytd)}
          </div>
          {cash.accounts.length > 1 && (
            <div className="mt-1 text-xs text-gray-500">
              {cash.accounts.map((a, i) => (
                <span key={a.account}>
                  {i > 0 && ' · '}
                  {a.account} {a.latest ? usd(a.latest.balance) : '—'}
                </span>
              ))}
            </div>
          )}
        </div>
        {pts.length > 1 && (
          <Link href="/finance" title="Month-end total cash, last 12 months — open the full chart" className="text-blue-600">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-60" aria-label="Month-end balance trend">
              <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>{pts[0]!.month}</span>
              <span>{pts[pts.length - 1]!.month}</span>
            </div>
          </Link>
        )}
      </div>
    </Card>
  );
}
