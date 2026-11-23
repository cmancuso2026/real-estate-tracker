'use client';

import { usePathname } from 'next/navigation';
import { MultiSelect } from '@/components/MultiSelect';
import { hasActiveFilters, PROP_PREFIX } from '@/lib/finance-ui/filters';
import { MON_SHORT } from '@/lib/finance-ui/format';
import { SOURCES } from '@/lib/finance-ui/transactions';
import { FinanceDataProvider, useFinance } from './FinanceData';
import { NoteTooltip } from './NoteTooltip';
import { selectCls } from './ui';


/** Pages that don't use the global filters. */
const NO_FILTERS = ['/finance/attribution'];

/** The global filters: every value here applies to every finance page. */
function FilterBar() {
  const { years, months, selYears, selMonths, setSelYears, setSelMonths, tax, props, filters, setFilters, clearFilters, propertyOptions } =
    useFinance();
  const linkedProperty = filters.linkedPropertyId ? propertyOptions.find((p) => p.id === filters.linkedPropertyId) : null;
  const linkedProject = filters.linkedProjectId
    ? propertyOptions.flatMap((p) => p.projects).find((w) => w.id === filters.linkedProjectId)
    : null;
  const catOptions = filters.group && tax.groups[filters.group] ? tax.groups[filters.group]! : tax.allSubcats;
  const showProps = !filters.group || filters.group === 'Investments';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm" data-testid="filter-bar">
      <MultiSelect
        options={years}
        selected={years.filter((y) => selYears.has(y))}
        onChange={setSelYears}
        noun="years"
      />
      <MultiSelect
        options={months}
        selected={months.filter((m) => selMonths.has(m))}
        onChange={setSelMonths}
        noun="months"
        renderLabel={(m) => MON_SHORT[parseInt(m, 10)]}
      />
      <select
        aria-label="Group filter"
        className={selectCls}
        value={filters.group}
        onChange={(e) => setFilters({ group: e.target.value, category: '' })}
      >
        <option value="">All groups</option>
        {Object.keys(tax.groups).map((g) => (
          <option key={g}>{g}</option>
        ))}
      </select>
      <select
        aria-label="Category filter"
        className={selectCls}
        value={filters.category}
        onChange={(e) => setFilters({ category: e.target.value })}
      >
        <option value="">All categories</option>
        {showProps && props.length > 0 && (
          <optgroup label="Properties (net)">
            {props.map((p) => (
              <option key={p.id} value={PROP_PREFIX + p.id}>
                🏠 {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Categories">
          {catOptions.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </optgroup>
      </select>
      <select aria-label="Source filter" className={selectCls} value={filters.source} onChange={(e) => setFilters({ source: e.target.value })}>
        <option value="">All sources</option>
        {SOURCES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <input
        type="search"
        aria-label="Search transactions"
        placeholder="Search…"
        value={filters.search}
        onChange={(e) => setFilters({ search: e.target.value })}
        className="w-44 rounded-lg border border-gray-300 px-2.5 py-1 text-sm"
      />
      {filters.linkedPropertyId && (
        <button
          onClick={() => setFilters({ linkedPropertyId: null })}
          className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-200"
          title="Remove filter"
        >
          Linked to {linkedProperty?.name ?? `property ${filters.linkedPropertyId}`} ✕
        </button>
      )}
      {filters.linkedProjectId && (
        <button
          onClick={() => setFilters({ linkedProjectId: null })}
          className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 hover:bg-purple-200"
          title="Remove filter"
        >
          Project: {linkedProject?.name ?? `#${filters.linkedProjectId}`} ✕
        </button>
      )}
      {hasActiveFilters(filters) && (
        <button onClick={clearFilters} className="text-xs font-medium text-blue-600 hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { loading, error, reload } = useFinance();
  return (
    <div className="space-y-4">
      {!NO_FILTERS.includes(pathname) && <FilterBar />}

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

/** Wraps every /finance page: shared data + global filters. */
export function FinanceShell({ children }: { children: React.ReactNode }) {
  return (
    <FinanceDataProvider>
      <ShellBody>{children}</ShellBody>
    </FinanceDataProvider>
  );
}
