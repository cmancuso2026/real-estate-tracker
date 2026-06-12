import { GradeMeForm } from '@/components/GradeMeForm';
import { getListingZips } from '@/lib/queries';

// The grader reads the live database on each submission.
export const dynamic = 'force-dynamic';

export default async function GradePage() {
  const zips = await getListingZips();

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Grade a Property</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Enter a property&apos;s details to run the full investment scoring engine — using rental
          comps and for-sale listings already tracked in that zip — and get an A–F grade with a
          full breakdown.
        </p>
      </div>

      <GradeMeForm zips={zips} />
    </>
  );
}
