import Link from 'next/link';
import { getProfile } from '@/lib/profile';
import { ProfileForm } from '@/components/ProfileForm';

// Always read the live profile from the database.
export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const profile = await getProfile();

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Investor Profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Set your buy-box. The dashboard filters all listings and grades against these
          settings before showing results.
        </p>
      </div>

      {saved && (
        <div className="mb-5 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
          Profile saved.{' '}
          <Link href="/" className="font-semibold underline">
            View filtered dashboard →
          </Link>
        </div>
      )}

      <ProfileForm profile={profile} />
    </>
  );
}
