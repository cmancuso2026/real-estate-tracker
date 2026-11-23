'use client';

/**
 * Shown instead of a blank page when the Tracker can't load. The full error is
 * in the server log (lines starting with [tracker]); the digest links the two.
 */
export default function TrackerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800" role="alert" data-testid="tracker-error">
      <p className="text-base font-semibold">The Tracker couldn&apos;t load.</p>
      <p className="mt-1">
        The server log has the details (search for <code className="rounded bg-white px-1">[tracker]</code>
        {error.digest ? (
          <>
            {' '}
            or <code className="rounded bg-white px-1">{error.digest}</code>
          </>
        ) : null}
        ).
      </p>
      <button
        onClick={reset}
        className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-100"
      >
        Try again
      </button>
    </div>
  );
}
