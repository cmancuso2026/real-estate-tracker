import { getGradedProperties, getSummary } from '@/lib/queries';
import { SummaryCards } from '@/components/SummaryCards';
import { ListingsExplorer } from '@/components/ListingsExplorer';

// Always read the live SQLite database on each request.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  const summary = getSummary();
  const properties = getGradedProperties();

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Investment Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Graded for-sale properties across your target markets.
        </p>
      </div>

      <SummaryCards summary={summary} />

      {properties.length === 0 ? (
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
      ) : (
        <ListingsExplorer properties={properties} />
      )}
    </>
  );
}
