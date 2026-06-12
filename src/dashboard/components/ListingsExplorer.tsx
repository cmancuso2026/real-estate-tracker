'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  fmtBedsBaths,
  fmtMoney,
  fmtPct,
  fmtSignedMoney,
  fmtSqft,
  fmtDate,
  propertyTypeLabel,
  formatThousands,
  parseThousands,
  GRADE_ORDER,
  type Letter,
} from '@/lib/format';
import type { GradedRow } from '@/lib/queries';
import { GradeBadge } from './GradeBadge';
import { MultiSelect } from './MultiSelect';

type SortKey =
  | 'address'
  | 'type'
  | 'beds'
  | 'sqft'
  | 'price'
  | 'ppsf'
  | 'rent'
  | 'coc'
  | 'cashflow'
  | 'grade'
  | 'added';

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right' | 'center';
  /** Numeric/string value used for sorting. */
  value: (r: GradedRow) => number | string;
}

const NEG_INF = Number.NEGATIVE_INFINITY;
const num = (n: number | null) => (n == null || !Number.isFinite(n) ? NEG_INF : n);

const COLUMNS: Column[] = [
  { key: 'address', label: 'Address', align: 'left', value: (r) => (r.address ?? '').toLowerCase() },
  { key: 'type', label: 'Type', align: 'left', value: (r) => propertyTypeLabel(r.property_type) },
  { key: 'beds', label: 'Bed/Bath', align: 'center', value: (r) => num(r.bedrooms) },
  { key: 'sqft', label: 'SqFt', align: 'right', value: (r) => num(r.living_area) },
  { key: 'price', label: 'List Price', align: 'right', value: (r) => num(r.price) },
  { key: 'ppsf', label: 'Price/SqFt', align: 'right', value: (r) => num(r.price_per_sqft) },
  { key: 'rent', label: 'Est. Rent', align: 'right', value: (r) => num(r.est_rent) },
  { key: 'coc', label: 'CoC %', align: 'right', value: (r) => num(r.coc_return) },
  { key: 'cashflow', label: 'Cash Flow', align: 'right', value: (r) => num(r.monthly_cashflow) },
  { key: 'grade', label: 'Grade', align: 'center', value: (r) => r.overall_score },
  { key: 'added', label: 'Added', align: 'right', value: (r) => r.first_seen_at ?? '' },
];

const SELECT =
  'rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900';

export function ListingsExplorer({ properties }: { properties: GradedRow[] }) {
  const router = useRouter();

  const zips = useMemo(
    () =>
      Array.from(new Set(properties.map((p) => p.zip_code).filter(Boolean) as string[])).sort(),
    [properties],
  );

  // Multi-select filters default to everything selected (no filtering).
  const [selectedZips, setSelectedZips] = useState<string[]>(() => zips);
  const [grades, setGrades] = useState<string[]>(() => [...GRADE_ORDER]);
  const [type, setType] = useState('');
  const [minBeds, setMinBeds] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'grade',
    dir: 'desc',
  });

  const filtered = useMemo(() => {
    const minB = minBeds ? Number(minBeds) : null;
    const minP = parseThousands(minPrice);
    const maxP = parseThousands(maxPrice);

    const rows = properties.filter((p) => {
      if (!selectedZips.includes(p.zip_code ?? '')) return false;
      if (type && propertyTypeLabel(p.property_type) !== type) return false;
      if (!grades.includes(p.overall_grade ?? '')) return false;
      if (minB != null && (p.bedrooms ?? 0) < minB) return false;
      if (minP != null && (p.price ?? 0) < minP) return false;
      if (maxP != null && (p.price ?? Infinity) > maxP) return false;
      return true;
    });

    const col = COLUMNS.find((c) => c.key === sort.key)!;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [properties, selectedZips, type, minBeds, minPrice, maxPrice, grades, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'address' || key === 'type' ? 'asc' : 'desc' },
    );
  }

  function reset() {
    setSelectedZips(zips);
    setType('');
    setMinBeds('');
    setMinPrice('');
    setMaxPrice('');
    setGrades([...GRADE_ORDER]);
  }

  const hasFilters =
    type ||
    minBeds ||
    minPrice ||
    maxPrice ||
    selectedZips.length !== zips.length ||
    grades.length !== GRADE_ORDER.length;

  return (
    <section className="mt-6">
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MultiSelect
          options={zips}
          selected={selectedZips}
          onChange={setSelectedZips}
          noun="zips"
        />

        <select className={SELECT} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="SFH">SFH</option>
          <option value="Multi">Multi</option>
        </select>

        <select className={SELECT} value={minBeds} onChange={(e) => setMinBeds(e.target.value)}>
          <option value="">Any beds</option>
          {[1, 2, 3, 4, 5].map((b) => (
            <option key={b} value={b}>
              {b}+ beds
            </option>
          ))}
        </select>

        <input
          className={`${SELECT} w-28`}
          type="text"
          inputMode="numeric"
          placeholder="Min $"
          value={minPrice}
          onChange={(e) => setMinPrice(formatThousands(e.target.value))}
        />
        <input
          className={`${SELECT} w-28`}
          type="text"
          inputMode="numeric"
          placeholder="Max $"
          value={maxPrice}
          onChange={(e) => setMaxPrice(formatThousands(e.target.value))}
        />

        <MultiSelect
          options={[...GRADE_ORDER]}
          selected={grades}
          onChange={setGrades}
          noun="grades"
          renderLabel={(g) => `Grade ${g}`}
        />

        {hasFilters && (
          <button
            type="button"
            onClick={reset}
            className="rounded-lg px-2.5 py-1.5 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            Clear
          </button>
        )}

        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
          {filtered.length} of {properties.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`cursor-pointer select-none whitespace-nowrap px-3 py-2.5 font-semibold ${
                      c.align === 'right'
                        ? 'text-right'
                        : c.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    } hover:text-gray-900 dark:hover:text-white`}
                  >
                    {c.label}
                    <span className="ml-1 inline-block w-2 text-gray-400">
                      {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.listing_id}
                onClick={() => router.push(`/property/${p.listing_id}`)}
                className="cursor-pointer border-t border-gray-100 hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-gray-800/60"
              >
                <td className="max-w-[18rem] truncate px-3 py-2.5">
                  <div className="truncate font-medium">{p.address ?? `Listing ${p.listing_id}`}</div>
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {[p.city, p.zip_code].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-3 py-2.5">{propertyTypeLabel(p.property_type)}</td>
                <td className="px-3 py-2.5 text-center tabular">
                  {fmtBedsBaths(p.bedrooms, p.bathrooms)}
                </td>
                <td className="px-3 py-2.5 text-right tabular">{fmtSqft(p.living_area)}</td>
                <td className="px-3 py-2.5 text-right tabular">{fmtMoney(p.price)}</td>
                <td className="px-3 py-2.5 text-right tabular">{fmtMoney(p.price_per_sqft)}</td>
                <td className="px-3 py-2.5 text-right tabular">{fmtMoney(p.est_rent)}</td>
                <td className="px-3 py-2.5 text-right tabular">{fmtPct(p.coc_return)}</td>
                <td
                  className={`px-3 py-2.5 text-right tabular ${
                    (p.monthly_cashflow ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : ''
                  }`}
                >
                  {fmtSignedMoney(p.monthly_cashflow)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <GradeBadge grade={p.overall_grade} size="sm" />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-gray-500 dark:text-gray-400">
                  {fmtDate(p.first_seen_at)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="px-3 py-10 text-center text-gray-500 dark:text-gray-400"
                >
                  No properties match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
