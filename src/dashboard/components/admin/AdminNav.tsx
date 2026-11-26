'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const ADMIN_SECTIONS = [
  { href: '/admin/categories', label: 'Categories and groups' },
  { href: '/admin/trades', label: 'Trades' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/property-mapping', label: 'Property mapping' },
  { href: '/admin/merchant-rules', label: 'Merchant rules' },
  { href: '/admin/attribution', label: 'Attribution' },
  { href: '/admin/rent-backfill', label: 'Rent from uploads' },
  { href: '/admin/investor-profile', label: 'Investor profile' },
  { href: '/admin/change-log', label: 'Change log' },
];

/** Left sidebar for the Admin portal. */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-0.5">
      {ADMIN_SECTIONS.map((s) => {
        const active = pathname.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
