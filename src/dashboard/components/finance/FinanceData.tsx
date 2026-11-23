'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { financeApi } from './api';
import { QUEUE_EVENT } from '@/components/NavLinks';
import { buildTaxonomy, type Taxonomy } from '@/lib/finance-ui/taxonomy';
import {
  mapTxn,
  type ApiTxn,
  type CategorySetting,
  type Groups,
  type PropertyGroup,
  type PropertyOption,
  type Txn,
} from '@/lib/finance-ui/types';
import { applyGlobalFilters, EMPTY_FILTERS, type GlobalFilters } from '@/lib/finance-ui/filters';
import {
  defaultMonthSelection,
  defaultYearSelection,
  filterByPeriod,
  monthsInData,
  yearsInData,
} from '@/lib/finance-ui/period';
import { DEFINITIONS, metricsContext, type MetricsCtx } from '@/lib/finance-ui/metrics';

/**
 * One shared copy of the finance data for every /finance page, like the old
 * single-page app: ALL transactions are loaded once and filtered in the
 * browser, so the KPI cards, chart, Spending table and Transactions table are
 * always computed from the same rows. Lives in app/finance/layout.tsx, so the
 * data and the year/month selection survive moving between finance pages.
 */
interface FinanceData {
  loading: boolean;
  error: string | null;
  txns: Txn[];
  tax: Taxonomy;
  props: PropertyGroup[];
  years: string[];
  months: string[];
  selYears: Set<string>;
  selMonths: Set<string>;
  setSelYears: (v: string[]) => void;
  setSelMonths: (v: string[]) => void;
  /** Global filters (group, category/property, source, search); apply on every page. */
  filters: GlobalFilters;
  setFilters: (patch: Partial<GlobalFilters>) => void;
  clearFilters: () => void;
  /** Rows in the selected years × months with the global filters applied: what every view shows. */
  filteredTxns: Txn[];
  /** All years/months with the global filters applied (for "Compare to"). */
  comparePool: Txn[];
  /** Rows in the selected years × months, before the other filters. */
  periodTxns: Txn[];
  /** Replace one transaction's fields locally after a successful save. */
  patchTxns: (ids: number[], patch: Partial<Txn>) => void;
  /** Reload everything (after an upload) and reset the period to the defaults. */
  reload: () => Promise<void>;
  /** Category rules (category_settings), by category. */
  settings: Map<string, CategorySetting>;
  /** How income / spending / cash flow are counted (src/finance/lib/metrics.js). */
  metricsCtx: MetricsCtx;
  definitions: typeof DEFINITIONS;
  requiresProperty: (category: string) => boolean;
  allowProjectTag: (category: string) => boolean;
  /** Properties with units and projects, for the attribution pickers. */
  propertyOptions: PropertyOption[];
  reloadPropertyOptions: () => Promise<void>;
  /** Transactions waiting for a property (Needs-property queue), across all dates. */
  unattributedCount: number;
}

const Ctx = createContext<FinanceData | null>(null);

export function useFinance(): FinanceData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFinance must be used inside <FinanceDataProvider>');
  return v;
}

export function FinanceDataProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [groups, setGroups] = useState<Groups>({});
  const [catToGroupApi, setCatToGroupApi] = useState<Record<string, string>>({});
  const [incomeCats, setIncomeCats] = useState<string[]>([]);
  const [props, setProps] = useState<PropertyGroup[]>([]);
  const [selYears, setSelYearsState] = useState<Set<string>>(new Set());
  const [selMonths, setSelMonthsState] = useState<Set<string>>(new Set());
  const [filters, setFiltersState] = useState<GlobalFilters>(EMPTY_FILTERS);
  const [settingsList, setSettingsList] = useState<CategorySetting[]>([]);
  const [propertyOptions, setPropertyOptions] = useState<PropertyOption[]>([]);

  const reloadPropertyOptions = useCallback(async () => {
    const r = await financeApi
      .get<{ properties: PropertyOption[] }>('/api/finance/property-options')
      .catch(() => ({ properties: [] as PropertyOption[] }));
    setPropertyOptions(r.properties || []);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, list, pg, cs, metrics] = await Promise.all([
        financeApi.get<{ groups: Groups; cat_to_group: Record<string, string> }>('/api/finance/categories'),
        financeApi.get<{ transactions: ApiTxn[] }>('/api/finance/transactions?limit=100000'),
        financeApi
          .get<{ properties: PropertyGroup[] }>('/api/finance/property-groups')
          .catch(() => ({ properties: [] as PropertyGroup[] })), // roll-ups are optional
        financeApi.get<{ settings: CategorySetting[] }>('/api/finance/category-settings'),
        financeApi.get<{ income_categories: string[] }>('/api/finance/metrics'),
        reloadPropertyOptions(),
      ]);
      setIncomeCats(metrics.income_categories || []);
      setSettingsList(cs.settings || []);
      const loaded = (list.transactions || []).map(mapTxn);
      setGroups(cats.groups || {});
      setCatToGroupApi(cats.cat_to_group || {});
      setProps(pg.properties || []);
      setTxns(loaded);
      // Like the old loader: every (re)load resets the period to the defaults.
      // A link like /finance/transactions?project=12 shows that project's rows
      // across all dates; otherwise the period starts at the defaults.
      const qs = new URLSearchParams(window.location.search);
      const linkedProjectId = Number(qs.get('project')) || null;
      const linkedPropertyId = Number(qs.get('property')) || null;
      if (linkedProjectId || linkedPropertyId) {
        setFiltersState({ ...EMPTY_FILTERS, linkedProjectId, linkedPropertyId });
        setSelYearsState(new Set(yearsInData(loaded)));
        setSelMonthsState(new Set(monthsInData(loaded)));
      } else {
        setSelYearsState(new Set(defaultYearSelection(yearsInData(loaded))));
        setSelMonthsState(new Set(defaultMonthSelection(monthsInData(loaded))));
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load data: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [reloadPropertyOptions]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tax = useMemo(() => buildTaxonomy(groups, catToGroupApi), [groups, catToGroupApi]);
  const metricsCtx = useMemo(() => metricsContext(tax.catToGroup, incomeCats), [tax, incomeCats]);
  const years = useMemo(() => yearsInData(txns), [txns]);
  const months = useMemo(() => monthsInData(txns), [txns]);
  const periodTxns = useMemo(() => filterByPeriod(txns, selYears, selMonths, tax), [txns, selYears, selMonths, tax]);
  const comparePool = useMemo(() => applyGlobalFilters(txns, filters, tax, props), [txns, filters, tax, props]);
  const filteredTxns = useMemo(
    () => filterByPeriod(comparePool, selYears, selMonths, tax),
    [comparePool, selYears, selMonths, tax],
  );

  const settings = useMemo(() => new Map(settingsList.map((s) => [s.category, s])), [settingsList]);
  const requiresProperty = useCallback((c: string) => !!settings.get(c)?.requires_property, [settings]);
  const allowProjectTag = useCallback((c: string) => settings.get(c)?.allow_project_tag ?? true, [settings]);
  const unattributedCount = useMemo(
    () => txns.filter((t) => !t.fullyAllocated && requiresProperty(t.cat)).length,
    [txns, requiresProperty],
  );

  // Keep the main nav's Needs Property badge in step with what you just did.
  useEffect(() => {
    if (!loading) window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: unattributedCount }));
  }, [unattributedCount, loading]);

  const patchTxns = useCallback((ids: number[], patch: Partial<Txn>) => {
    const set = new Set(ids);
    setTxns((cur) => cur.map((t) => (set.has(t.id) ? { ...t, ...patch } : t)));
  }, []);

  const value: FinanceData = {
    loading,
    error,
    txns,
    tax,
    props,
    years,
    months,
    selYears,
    selMonths,
    setSelYears: (v) => setSelYearsState(new Set(v)),
    setSelMonths: (v) => setSelMonthsState(new Set(v)),
    filters,
    setFilters: (patch) => setFiltersState((f) => ({ ...f, ...patch })),
    clearFilters: () => setFiltersState(EMPTY_FILTERS),
    filteredTxns,
    comparePool,
    periodTxns,
    patchTxns,
    reload,
    settings,
    metricsCtx,
    definitions: DEFINITIONS,
    requiresProperty,
    allowProjectTag,
    propertyOptions,
    reloadPropertyOptions,
    unattributedCount,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
