/** A project as /api/v2/work-orders returns it (the fields the overview reads). */
export interface OverviewProject {
  id: number;
  property_id: number;
  property_address: string | null;
  project_name: string | null;
  description: string | null;
  status: string;
  trades?: string[];
  rating?: number | null;
  quoted_cost?: number | string | null;
  actual_cost?: number | string | null;
  date_completed?: string | null;
  created_at?: string | null;
  vendor_name?: string | null;
  vendor_phone?: string | null;
  units?: { unit_label: string }[];
  quotes?: {
    vendor_name: string;
    vendor_phone?: string | null;
    vendor_email?: string | null;
    vendor_rating?: number | null;
    quoted_cost: number | string | null;
    final_cost: number | string | null;
    is_selected: boolean;
  }[];
  recurring?: { frequency: string; amount: number | string; monthly_amount: number | string; start_date: string | null; end_date: string | null }[];
}

/** One row of the Vendors → Projects table. */
export interface ProjectRow {
  id: number;
  propertyId: number;
  property: string;
  name: string;
  description: string | null;
  status: string;
  trades: string[];
  rating: number | null;
  vendor: string | null;
  vendorPhone: string | null;
  vendorEmail: string | null;
  vendorRating: number | null;
  /** The chosen quote's quoted cost, else the project's starting cost. */
  quoted: number | null;
  /** The chosen quote's final cost, else the project's actual cost. */
  final: number | null;
  /** Spend from linked finance transactions (positive = spent). */
  actual: number;
  txnCount: number;
  /** Actual minus quoted (positive = over), when both exist. */
  variance: number | null;
  quoteCount: number;
  units: string[];
  recurring: NonNullable<OverviewProject['recurring']>;
  created: string | null;
  completed: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Flatten projects + finance roll-ups into table rows. */
export function projectRows(
  projects: OverviewProject[],
  actuals: Record<number, { actual_spend: number; transaction_count: number }>,
): ProjectRow[] {
  return projects.map((p) => {
    const quotes = p.quotes ?? [];
    const sel = quotes.find((q) => q.is_selected) ?? (quotes.length === 1 ? quotes[0] : undefined);
    const a = actuals[p.id];
    const quoted = num(sel?.quoted_cost) ?? num(p.quoted_cost);
    const actual = a?.actual_spend ?? 0;
    const txnCount = a?.transaction_count ?? 0;
    return {
      id: p.id,
      propertyId: p.property_id,
      property: p.property_address ?? `Property ${p.property_id}`,
      name: p.project_name || p.description || `Project #${p.id}`,
      description: p.project_name ? p.description : null,
      status: p.status,
      trades: p.trades ?? [],
      rating: num(p.rating),
      vendor: sel?.vendor_name ?? p.vendor_name ?? null,
      vendorPhone: sel?.vendor_phone ?? (sel ? null : p.vendor_phone ?? null),
      vendorEmail: sel?.vendor_email ?? null,
      vendorRating: num(sel?.vendor_rating),
      quoted,
      final: num(sel?.final_cost) ?? num(p.actual_cost),
      actual,
      txnCount,
      variance: quoted != null && txnCount ? Math.round((actual - quoted) * 100) / 100 : null,
      quoteCount: quotes.length,
      units: (p.units ?? []).map((u) => u.unit_label),
      recurring: p.recurring ?? [],
      created: p.created_at ?? null,
      completed: p.date_completed ?? null,
    };
  });
}
