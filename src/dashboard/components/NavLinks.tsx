'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Fired by the finance pages whenever the Needs-property count changes. */
export const QUEUE_EVENT = 'mancuso:queue-count';

interface NavLink {
  href: string;
  label: string;
  /** Active only on this exact path. */
  exact?: boolean;
  /** Also active under these path prefixes. */
  also?: string[];
  badge?: boolean;
}

interface Section {
  label: string;
  /** Where the section name takes you. */
  href: string;
  /** Path prefixes that belong to this section (shows its tabs). */
  paths: string[];
  links: NavLink[];
}

export const GROUPS: Section[] = [
  {
    label: 'Finances',
    href: '/finance',
    paths: ['/finance'],
    links: [
      { href: '/finance', label: 'Categories', exact: true },
      { href: '/finance/overview', label: 'Overview' },
      { href: '/finance/transactions', label: 'Transactions' },
      { href: '/finance/attribution', label: 'Needs Property', badge: true },
    ],
  },
  {
    label: 'Properties',
    href: '/properties',
    paths: ['/properties', '/vendors'],
    links: [
      { href: '/properties', label: 'My Properties' },
      { href: '/vendors', label: 'Vendors' },
    ],
  },
  {
    label: 'Investing',
    href: '/tracker',
    paths: ['/tracker', '/grade', '/property/'],
    links: [
      { href: '/tracker', label: 'Tracker', also: ['/property/'] },
      { href: '/grade', label: 'Grade a Property' },
    ],
  },
];

function isActive(pathname: string, l: NavLink) {
  if (l.also?.some((p) => pathname.startsWith(p))) return true;
  if (l.exact) return pathname === l.href;
  return pathname.startsWith(l.href);
}
const sectionOf = (pathname: string) => GROUPS.find((g) => g.paths.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/')));

function Count({ n, testId }: { n: number; testId?: string }) {
  return (
    <span data-testid={testId} className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-px text-[11px] font-semibold leading-4 text-orange-700 tabular">
      {n}
    </span>
  );
}

/**
 * Site header. One row: logo, the three sections, Upload and Admin. Under it,
 * the pages of the section you're in, as tabs — so every page is one click
 * away and nothing wraps. On phones it all folds behind a Menu button.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [queue, setQueue] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]); // close the phone menu after navigating

  // Needs-property count: refreshed on every navigation, and immediately when
  // the finance pages report a change (assigning properties, toggling rules).
  useEffect(() => {
    let alive = true;
    fetch('/api/finance/attribution/count')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && typeof d.count === 'number' && setQueue(d.count))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);
  useEffect(() => {
    const onCount = (e: Event) => setQueue((e as CustomEvent<number>).detail);
    window.addEventListener(QUEUE_EVENT, onCount);
    return () => window.removeEventListener(QUEUE_EVENT, onCount);
  }, []);

  const current = sectionOf(pathname);
  const hasQueue = queue != null && queue > 0;

  return (
    <>
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-base font-semibold text-gray-900">
          <span aria-hidden>🏠</span>
          <span>Mancuso HQ</span>
        </Link>

        <nav aria-label="Sections" className="hidden h-full items-stretch gap-1 md:flex">
          {GROUPS.map((g) => {
            const active = current === g;
            return (
              <Link
                key={g.label}
                href={g.href}
                aria-current={active ? 'true' : undefined}
                className={`flex items-center border-b-2 px-3 text-sm font-medium transition-colors ${
                  active ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                {g.label}
                {g.label === 'Finances' && hasQueue && !active && <Count n={queue!} />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/upload"
            data-testid="nav-upload"
            aria-current={pathname === '/upload' ? 'page' : undefined}
            className="hidden items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 sm:flex"
          >
            <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current">
              <path d="M10 3l4 4h-3v6H9V7H6l4-4zM4 15h12v2H4z" />
            </svg>
            Upload
          </Link>
          <Link
            href="/admin"
            aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
            className={`hidden rounded-lg px-3 py-1.5 text-sm font-medium sm:block ${
              pathname.startsWith('/admin') ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            Admin
          </Link>
          <button
            type="button"
            className="flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 md:hidden"
            aria-expanded={open}
            aria-controls="main-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Menu'}
            {!open && hasQueue && <Count n={queue!} />}
          </button>
        </div>
      </div>

      {/* Pages of the current section (desktop) */}
      {current && (
        <nav aria-label={current.label} className="hidden border-t border-gray-100 md:block">
          <div className="mx-auto flex h-10 max-w-7xl items-stretch gap-1 px-4 sm:px-6">
            {current.links.map((l) => {
              const active = isActive(pathname, l);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center border-b-2 px-3 text-sm transition-colors ${
                    active ? 'border-gray-900 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {l.label}
                  {l.badge && hasQueue && <Count n={queue!} testId="nav-queue-badge" />}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Phones: everything in one list */}
      {open && (
        <nav id="main-nav" aria-label="Main" className="border-t border-gray-100 px-4 pb-3 md:hidden">
          {GROUPS.map((g) => (
            <div key={g.label} className="pt-3">
              <div className="px-2 text-xs font-medium text-gray-400">{g.label}</div>
              {g.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive(pathname, l) ? 'page' : undefined}
                  className={`flex items-center rounded-md px-2 py-2 text-sm ${isActive(pathname, l) ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700'}`}
                >
                  {l.label}
                  {l.badge && hasQueue && <Count n={queue!} />}
                </Link>
              ))}
            </div>
          ))}
          <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
            <Link href="/upload" className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white">
              Upload
            </Link>
            <Link href="/admin" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-700">
              Admin
            </Link>
          </div>
        </nav>
      )}
    </>
  );
}
