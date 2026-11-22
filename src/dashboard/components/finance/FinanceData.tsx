'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { financeApi } from './api';
import { buildTaxonomy, type Taxonomy } from '@/lib/finance-ui/taxonomy';
import { mapTxn, type ApiTxn, type Groups, type PropertyGroup, type Txn } from '@/lib/finance-ui/types';
import {
  defaultMonthSelection,
  defaultYearSelection,
  filterByPeriod,
  monthsInData,
  yearsInData,
} from '@/lib/finance-ui/period';

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
  /** Rows in the selected years × months. */
  periodTxns: Txn[];
  /** Replace one transaction's fields locally after a successful save. */
  patchTxns: (ids: number[], patch: Partial<Txn>) => void;
  /** Reload everything (after an upload) and reset the period to the defaults. */
  reload: () => Promise<void>;
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
  const [props, setProps] = useState<PropertyGroup[]>([]);
  const [selYears, setSelYearsState] = useState<Set<string>>(new Set());
  const [selMonths, setSelMonthsState] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, list, pg] = await Promise.all([
        financeApi.get<{ groups: Groups }>('/api/finance/categories'),
        financeApi.get<{ transactions: ApiTxn[] }>('/api/finance/transactions?limit=100000'),
        financeApi
          .get<{ properties: PropertyGroup[] }>('/api/finance/property-groups')
          .catch(() => ({ properties: [] as PropertyGroup[] })), // roll-ups are optional
      ]);
      const loaded = (list.transactions || []).map(mapTxn);
      setGroups(cats.groups || {});
      setProps(pg.properties || []);
      setTxns(loaded);
      // Like the old loader: every (re)load resets the period to the defaults.
      setSelYearsState(new Set(defaultYearSelection(yearsInData(loaded))));
      setSelMonthsState(new Set(defaultMonthSelection(monthsInData(loaded))));
    } catch (err) {
      console.error(err);
      setError('Failed to load data: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tax = useMemo(() => buildTaxonomy(groups), [groups]);
  const years = useMemo(() => yearsInData(txns), [txns]);
  const months = useMemo(() => monthsInData(txns), [txns]);
  const periodTxns = useMemo(
    () => filterByPeriod(txns, selYears, selMonths, tax),
    [txns, selYears, selMonths, tax],
  );

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
    periodTxns,
    patchTxns,
    reload,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
