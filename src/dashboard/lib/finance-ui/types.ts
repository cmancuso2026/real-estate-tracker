/** A transaction as the finance UI uses it (same fields as the old page's mapTxn). */
export interface Txn {
  id: number;
  date: string; // 'YYYY-MM-DD'
  desc: string;
  src: string;
  amt: number; // signed: negative = expense
  cat: string;
  manual: boolean;
  cleared: boolean;
  note: string;
}

/** API transaction shape (GET /api/finance/transactions). */
export interface ApiTxn {
  id: number;
  date: string;
  description: string;
  amount: number;
  source: string;
  category: string;
  category_group: string;
  is_manual: boolean;
  review_cleared: boolean;
  note: string;
  confidence_score: number | null;
}

/** group → categories, as served by GET /api/finance/categories. */
export type Groups = Record<string, string[]>;

/** A property and the unit labels whose categories roll up to it ("1207 Rent" → unit 1207). */
export interface PropertyGroup {
  id: number;
  name: string;
  units: string[];
}

export function mapTxn(t: ApiTxn): Txn {
  return {
    id: t.id,
    date: t.date,
    desc: t.description,
    src: t.source,
    amt: Number(t.amount),
    cat: t.category,
    manual: !!t.is_manual,
    cleared: !!t.review_cleared,
    note: t.note || '',
  };
}
