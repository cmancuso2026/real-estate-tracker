'use client';

import type { Trade } from '@/lib/trades';

/**
 * Multi-select trade chips (vendor trades, project categories). `value` keeps
 * the order picked; a key no longer in the list (archived) still shows so it
 * can be removed.
 */
export function TradePicker({
  trades,
  value,
  onChange,
  label,
  ariaLabel = 'Trades',
}: {
  trades: Trade[];
  value: string[];
  onChange: (next: string[]) => void;
  label: (key: string) => string;
  ariaLabel?: string;
}) {
  const extra = value.filter((k) => !trades.some((t) => t.key === k));
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {[...trades.map((t) => t.key), ...extra].map((k) => {
        const on = value.includes(k);
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(k)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {on ? '✓ ' : ''}
            {label(k)}
          </button>
        );
      })}
      {trades.length === 0 && <span className="text-xs text-gray-400">No trades yet. Add them in Admin → Trades.</span>}
    </div>
  );
}

/** Read-only trade pills. */
export function TradePills({ keys, label }: { keys: string[]; label: (key: string) => string }) {
  if (!keys.length) return <span className="text-xs text-gray-400">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {keys.map((k) => (
        <span key={k} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {label(k)}
        </span>
      ))}
    </span>
  );
}
