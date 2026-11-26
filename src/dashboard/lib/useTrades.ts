'use client';

import { useCallback, useEffect, useState } from 'react';
import { humanizeTrade, type Trade } from './trades';

/**
 * The trade list (active ones by default; `all` includes archived), plus a
 * label lookup that also knows archived keys so old vendors/projects still
 * read well.
 */
export function useTrades(all = false) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/v2/trades?all=1');
      const rows: Trade[] = res.ok ? await res.json() : [];
      setLabels(Object.fromEntries(rows.map((t) => [t.key, t.label])));
      setTrades(all ? rows : rows.filter((t) => !t.archived));
    } catch {
      setTrades([]);
    }
  }, [all]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const label = useCallback((key: string | null | undefined) => (key ? (labels[key] ?? humanizeTrade(key)) : '—'), [labels]);
  return { trades, label, reload };
}
