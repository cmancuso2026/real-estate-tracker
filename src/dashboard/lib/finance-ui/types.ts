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
  /** Attribution, single property only (null for a split or none): property, project (work order) and unit. */
  propertyId: number | null;
  workOrderId: number | null;
  unitId: number | null;
  /** Every share of the transaction (transaction_allocations); one row = 100% to one property. */
  allocations: Alloc[];
  /** The shares add up to the amount. */
  fullyAllocated: boolean;
  /** Amount not yet given to a property when partly split (null when nothing is allocated). */
  unallocated: number | null;
}

/** One share of a transaction. amount has the transaction's sign. */
export interface Alloc {
  property_id: number;
  unit_id: number | null;
  work_order_id: number | null;
  amount: number;
  percent: number | null;
  input_mode: 'percent' | 'amount' | null;
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
  allocations?: Alloc[];
  allocated?: number;
  unallocated?: number | null;
  fully_allocated?: boolean;
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
    ...attributionOf(t),
  };
}

/** The attribution fields of a Txn from an API transaction (for patchTxns after a save). */
export function attributionOf(t: ApiTxn): Pick<Txn, 'propertyId' | 'workOrderId' | 'unitId' | 'allocations' | 'fullyAllocated' | 'unallocated'> {
  const allocations = (t.allocations ?? []).map((a) => ({ ...a, amount: Number(a.amount), percent: a.percent == null ? null : Number(a.percent) }));
  return {
    propertyId: t.property_id ?? null,
    workOrderId: t.work_order_id ?? null,
    unitId: t.unit_id ?? null,
    allocations,
    fullyAllocated: t.fully_allocated ?? (t.property_id != null),
    unallocated: t.unallocated ?? null,
  };
}

/** One property for the whole amount, as the server saves it for a single pick. */
export function singleAllocation(amt: number, property_id: number, unit_id: number | null, work_order_id: number | null) {
  return {
    propertyId: property_id,
    unitId: unit_id,
    workOrderId: work_order_id,
    allocations: [{ property_id, unit_id, work_order_id, amount: amt, percent: 100, input_mode: 'percent' as const }],
    fullyAllocated: true,
    unallocated: null,
  };
}

/** Transactions linked to a property or project through any of their shares. */
export const touchesProperty = (t: Txn, id: number) => t.allocations.some((a) => a.property_id === id);
export const touchesProject = (t: Txn, id: number) => t.allocations.some((a) => a.work_order_id === id);
