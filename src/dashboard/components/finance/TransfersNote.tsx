'use client';

/**
 * One quiet line saying card payments / transfers between your own accounts
 * are netted out (not income, not spending), with the breakdown on click.
 */
export function TransfersNote({ items }: { items: { cat: string; count: number; out: number; in: number }[] }) {
  if (!items.length) return null;
  const n = items.reduce((s, t) => s + t.count, 0);
  const usd = (v: number) => '$' + Math.round(v).toLocaleString('en-US');
  return (
    <details className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500" data-testid="transfers-note">
      <summary className="cursor-pointer select-none list-none hover:text-gray-700">
        ⓘ {n} card payment{n === 1 ? '' : 's'} and transfer{n === 1 ? '' : 's'} between your own accounts are netted out, not counted as income or spending.
      </summary>
      <div className="mt-1.5 space-y-1 pl-4">
        <p>
          Your paycheck pays the card bill, and the card paid for the individual purchases. Only those purchases count as
          spending; the bill payment (and the matching &ldquo;payment received&rdquo; on the card) would just count the
          same money again.
        </p>
        <ul>
          {items.map((t) => (
            <li key={t.cat}>
              {t.cat}: {t.count} · {t.out > 0 && `${usd(t.out)} paid`}
              {t.out > 0 && t.in > 0 && ' · '}
              {t.in > 0 && `${usd(t.in)} received on the card`}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
