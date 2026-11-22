'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MultiSelect } from '@/components/MultiSelect';
import { MON_SHORT } from '@/lib/finance-ui/format';
import { FinanceDataProvider, useFinance } from './FinanceData';
import { NoteTooltip } from './NoteTooltip';

const TABS = [
  { href: '/finance', label: 'Overview', exact: true },
  { href: '/finance/spending', label: 'Spending' },
  { href: '/finance/transactions', label: 'Transactions' },
  { href: '/finance/upload', label: 'Upload' },
];

function PeriodBar() {
  const { years, months, selYears, selMonths, setSelYears, setSelMonths } = useFinance();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Years</span>
        <MultiSelect
          options={years}
          selected={years.filter((y) => selYears.has(y))}
          onChange={setSelYears}
          noun="years"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Months</span>
        <MultiSelect
          options={months}
          selected={months.filter((m) => selMonths.has(m))}
          onChange={setSelMonths}
          noun="months"
          renderLabel={(m) => MON_SHORT[parseInt(m, 10)]}
        />
      </label>
    </div>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loading, error, reload } = useFinance();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          {TABS.map((t) => {
            const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {pathname !== '/finance/upload' && <PeriodBar />}
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button onClick={() => void reload()} className="font-medium underline">
            Retry
          </button>
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          Loading…
        </div>
      )}
      {children}
      <NoteTooltip />
    </div>
  );
}

/** Wraps every /finance page: shared data + period filter + sub-navigation. */
export function FinanceShell({ children }: { children: React.ReactNode }) {
  return (
    <FinanceDataProvider>
      <ShellBody>{children}</ShellBody>
    </FinanceDataProvider>
  );
}
