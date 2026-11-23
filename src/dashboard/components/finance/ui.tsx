/** Shared bits for the finance pages, in the dashboard's card style. */
export function Card({ children, className = '', ...rest }: { children: React.ReactNode; className?: string; 'data-testid'?: string }) {
  return (
    <div {...rest} className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const selectCls =
  'rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus:border-blue-500 focus:outline-none';

export const btnPrimary =
  'rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';
export const btnSecondary =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

/** Green for income/positive, red for expense/negative. */
export function amtCls(v: number): string {
  return v > 0 ? 'text-green-700' : 'text-red-600';
}
