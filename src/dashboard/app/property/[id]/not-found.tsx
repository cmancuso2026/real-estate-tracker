import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center dark:border-gray-700">
      <p className="text-lg font-medium">Property not found</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        This listing has no grade, or doesn&apos;t exist.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Back to all properties
      </Link>
    </div>
  );
}
