import Link from 'next/link';
import { getGradedProperties, getSummary } from '@/lib/queries';
import { getProfile, isProfileActive, type InvestorProfile } from '@/lib/profile';
import { fmtMoney, fmtPct } from '@/lib/format';
import { SummaryCards } from '@/components/SummaryCards';
import { ListingsExplorer } from '@/components/ListingsExplorer';

// Always read the live SQLite database on each request.
export const dynamic = 'force-dynamic';

/** Short human-readable chips describing the active profile constraints. */
function profileChips(p: InvestorProfile): string[] {
  const chips: string[] = [];
  if (p.minPurchasePrice != null) chips.push(`≥ ${fmtMoney(p.minPurchasePrice)}`);
  if (p.maxPurchasePrice != null) chips.push(`≤ ${fmtMoney(p.maxPurchasePrice)}`);
  if (p.availableCash != null) chips.push(`cash ${fmtMoney(p.availableCash)}`);
  if (p.minBeds != null) chips.push(`${p.minBeds}+ beds`);
  if (p.minCocReturn != null) chips.push(`CoC ≥ ${fmtPct(p.minCocReturn)}`);
  if (p.propertyTypes.length > 0) chips.push(p.propertyTypes.join(' / '));
  return chips;
}

export default function HomePage() {
  const profile = getProfile();
  const active = isProfileActive(profile);

  const allGraded = getGradedProperties();
  const properties = active ? getGradedProperties(profile) : allGraded;
  const summary = getSummary(active ? profile : undefined);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Investment Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Graded for-sale properties across your target markets.
        </p>
      </div>

      <SummaryCards summary={summary} profileActive={active} />

      {active && allGraded.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm dark:border-blue-900 dark:bg-blue-950/40">
          <span className="font-medium text-blue-800 dark:text-blue-200">
            Filtered to your Investor Profile
          </span>
          {profileChips(profile).map((c) => (
            <span
              key={c}
              className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/50 dark:text-blue-200 dark:ring-blue-800"
            >
              {c}
            </span>
          ))}
          <span className="text-blue-700 dark:text-blue-300">
            · {properties.length} of {allGraded.length} graded
          </span>
          <Link
            href="/settings"
            className="ml-auto font-semibold text-blue-700 hover:underline dark:text-blue-300"
          >
            Edit
          </Link>
        </div>
      )}

      {allGraded.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <p className="text-lg font-medium">No graded properties yet</p>
          <p className="mt-1 text-sm">
            Run{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
              npm run fetch:all
            </code>{' '}
            then{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">npm run grade</code>{' '}
            from the project root — or{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
              npm run seed:demo
            </code>{' '}
            for sample data.
          </p>
        </div>
      ) : properties.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400">
          <p className="text-lg font-medium">No properties match your Investor Profile</p>
          <p className="mt-1 text-sm">
            All {allGraded.length} graded {allGraded.length === 1 ? 'property is' : 'properties are'}{' '}
            outside your buy-box. Try loosening your{' '}
            <Link href="/settings" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
              Investor Profile
            </Link>
            .
          </p>
        </div>
      ) : (
        <ListingsExplorer properties={properties} />
      )}
    </>
  );
}
