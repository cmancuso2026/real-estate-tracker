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
  /** Attribution (Phase 5): owned property, project (work order) and unit. */
  propertyId: number | null;
  workOrderId: number | null;
  unitId: number | null;
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
  property_id: number | null;
  work_order_id: number | null;
  unit_id: number | null;
}

/** Per-category rules from category_settings. */
export interface CategorySetting {
  category: string;
  requires_property: boolean;
  allow_project_tag: boolean;
  default_property_id: number | null;
}

/** A property with its units and projects, for attribution pickers. */
export interface PropertyOption {
  id: number;
  name: string;
  units: { id: number; label: string }[];
  /** received/open first, then completed */
  projects: { id: number; name: string; status: string }[];
}

/** group → categories, as served by GET /api/finance/categories. */
export type Groups = Record<string, string[]>;

/** A property and the categories mapped to it (property_category_map), e.g. "1207 Rent". */
export interface PropertyGroup {
  id: number;
  name: string;
  units: string[];
  categories: string[];
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
    propertyId: t.property_id ?? null,
    workOrderId: t.work_order_id ?? null,
    unitId: t.unit_id ?? null,
  };
}
