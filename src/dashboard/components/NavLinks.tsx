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

const GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: 'Finances',
    links: [
      { href: '/finance', label: 'Overview', exact: true },
      { href: '/finance/spending', label: 'Spending' },
      { href: '/finance/transactions', label: 'Transactions' },
      { href: '/finance/upload', label: 'Upload' },
      { href: '/finance/attribution', label: 'Needs Property', badge: true },
    ],
  },
  {
    label: 'Properties',
    links: [
      { href: '/properties', label: 'My Properties' },
      { href: '/vendors', label: 'Vendors' },
    ],
  },
  {
    label: 'Investing',
    links: [
      { href: '/tracker', label: 'Tracker', also: ['/property/'] },
      { href: '/grade', label: 'Grade a Property' },
    ],
  },
];

function isActive(pathname: string, l: NavLink) {
  if (l.exact) return pathname === l.href;
  return pathname.startsWith(l.href) || !!l.also?.some((p) => pathname.startsWith(p));
}

/** Site header: logo, the grouped nav, and a Menu button on small screens. */
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

  return (
    <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
        <span aria-hidden>🏠</span>
        <span>Mancuso HQ</span>
      </Link>
      <button
        type="button"
        className="ml-auto flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 md:hidden"
        aria-expanded={open}
        aria-controls="main-nav"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Close' : 'Menu'}
        {!open && queue != null && queue > 0 && (
          <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular">{queue}</span>
        )}
      </button>
    <nav
      id="main-nav"
      aria-label="Main"
      className={`${open ? 'flex' : 'hidden'} w-full flex-col items-stretch gap-2 md:flex md:w-auto md:min-w-0 md:flex-1 md:flex-row md:flex-wrap md:items-center`}
    >
      {GROUPS.map((g) => (
        <div key={g.label} role="group" aria-label={g.label} className="flex flex-wrap items-center gap-0.5 rounded-lg bg-gray-100 p-1">
          <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{g.label}</span>
          {g.links.map((l) => {
            const active = isActive(pathname, l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {l.label}
                {l.badge && queue != null && queue > 0 && (
                  <span
                    data-testid="nav-queue-badge"
                    className="ml-1.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular"
                  >
                    {queue}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
      <Link
        href="/admin"
        aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
        className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors md:ml-auto ${
          pathname.startsWith('/admin') ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        Admin
      </Link>
    </nav>
    </div>
  );
}
