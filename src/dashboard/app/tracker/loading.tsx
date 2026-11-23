/** Shown at once while the Tracker loads every graded listing on the server. */
export default function TrackerLoading() {
  return (
    <div data-testid="tracker-loading" aria-busy="true">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Investment Dashboard</h1>
        <p className="text-sm text-gray-500">Loading graded properties…</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white" />
        ))}
      </div>
      <div className="mt-6 h-96 animate-pulse rounded-xl border border-gray-200 bg-white" />
    </div>
  );
}
