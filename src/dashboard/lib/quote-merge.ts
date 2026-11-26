/** What the AI parser reads from one quote file. */
export interface VendorQuoteExtracted {
  vendor_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  trade: string | null;
  project_name: string | null;
  quoted_cost: number | null;
  scope_of_work: string | null;
  quote_date: string | null;
  confidence_notes: string | null;
}

const first = <T,>(xs: (T | null | undefined)[]) => xs.find((x) => x != null && x !== '') ?? null;
const uniqueJoin = (xs: (string | null | undefined)[], sep: string) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const t = (x ?? '').trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.length ? out.join(sep) : null;
};

/**
 * Several files that make up one quote (e.g. the quote and its addendum, or a
 * multi-page quote sent as separate PDFs) → one quote. Vendor details come
 * from the first file that has them; the amount is the sum of the files'
 * amounts (edit it if one file revises another); scopes and notes are joined.
 */
export function mergeQuotes(parts: VendorQuoteExtracted[]): VendorQuoteExtracted {
  if (parts.length === 1) return parts[0]!;
  const amounts = parts.map((p) => p.quoted_cost).filter((n): n is number => n != null && Number.isFinite(n));
  const total = amounts.length ? Math.round(amounts.reduce((s, n) => s + n, 0) * 100) / 100 : null;
  const names = new Set(parts.map((p) => p.vendor_name?.trim().toLowerCase()).filter(Boolean));
  const notes = [
    `Combined from ${parts.length} files${amounts.length > 1 ? `: the amount is the sum (${amounts.map((n) => `$${n.toLocaleString('en-US')}`).join(' + ')}) — change it if one file revises another` : ''}.`,
    names.size > 1 ? `The files name different vendors (${[...new Set(parts.map((p) => p.vendor_name).filter(Boolean))].join(', ')}); check the vendor.` : null,
    ...parts.map((p) => p.confidence_notes),
  ];
  return {
    vendor_name: first(parts.map((p) => p.vendor_name)),
    vendor_phone: first(parts.map((p) => p.vendor_phone)),
    vendor_email: first(parts.map((p) => p.vendor_email)),
    trade: first(parts.map((p) => p.trade)),
    project_name: first(parts.map((p) => p.project_name)),
    quoted_cost: total,
    scope_of_work: uniqueJoin(parts.map((p) => p.scope_of_work), '\n'),
    quote_date: first(parts.map((p) => p.quote_date)),
    confidence_notes: uniqueJoin(notes, ' '),
  };
}
