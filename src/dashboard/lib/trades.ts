/** One trade from Admin → Trades (vendor trades and project categories). */
export interface Trade {
  key: string;
  label: string;
  sort_order: number;
  archived: boolean;
  vendor_count?: number;
  project_count?: number;
}

/** "AC / HVAC" → "ac_hvac": the stored key for a new trade. */
export function tradeKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Fallback label for a key with no trade row: "pest_control" → "Pest Control". */
export function humanizeTrade(key: string | null | undefined): string {
  if (!key) return '—';
  return key
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}
