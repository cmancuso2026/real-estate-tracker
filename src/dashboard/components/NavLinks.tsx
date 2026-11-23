'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

const PERSONAL_LINKS = [
  // Interim entry point; Phase 8 replaces this nav with Finances / Properties / Investing groups.
  { href: '/finance', label: 'Finances' },
  { href: '/properties', label: 'My Properties' },
  { href: '/rent', label: 'Import Rent' },
  { href: '/vendors', label: 'Vendors' },
];

const TRACKER_LINKS = [
  { href: '/tracker', label: 'Tracker' },
  { href: '/grade', label: 'Grade a Property' },
  { href: '/admin/investor-profile', label: 'Investor Profile' },
];

export function NavLinks() {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <nav className="flex items-center gap-1">
      {/* Personal / property management links */}
      <div className="flex items-center gap-1 rounded-lg bg-blue-50 px-1 py-1 dark:bg-blue-950/30">
        {PERSONAL_LINKS.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive(link.href)
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/40'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div className="mx-2 h-5 w-px bg-gray-200 dark:bg-gray-700" />

      {/* Tracker / investment links */}
      <div className="flex items-center gap-1 rounded-lg bg-gray-100 px-1 py-1 dark:bg-gray-800/60">
        {TRACKER_LINKS.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive(link.href)
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700/60'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>

      <Link
        href="/admin"
        className={`ml-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive('/admin') ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
        }`}
      >
        Admin
      </Link>

      <div className="ml-2">
        <ThemeToggle />
      </div>
    </nav>
  );
}
