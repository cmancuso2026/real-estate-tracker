/**
 * V2 Property Management Types
 * Mirrors the database schema for owned_properties, units, tenants, leases,
 * rent_collections, vendors, work_orders, escrow_accounts, escrow_statements,
 * and insurance_policies.
 *
 * All timestamp fields are TEXT in 'YYYY-MM-DD HH24:MI:SS' UTC format,
 * matching the existing schema convention. Date-only fields are 'YYYY-MM-DD'.
 */

// ---------------------------------------------------------------------------
// Owned Properties
// ---------------------------------------------------------------------------

export type PropertyType = 'duplex' | 'sfh' | 'triplex' | 'quad' | 'other';

export interface OwnedProperty {
  id: number;
  address: string;
  city: string;
  state: string;
  zip_code: string | null;
  property_type: PropertyType;
  unit_count: number;
  notes: string | null;
  created_at: string;
}

export type OwnedPropertyInsert = Omit<OwnedProperty, 'id' | 'created_at'>;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface Unit {
  id: number;
  property_id: number;
  unit_label: string;        // '1A', '1B', 'Upper', 'Lower'
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  notes: string | null;
  created_at: string;
}

export type UnitInsert = Omit<Unit, 'id' | 'created_at'>;

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export interface Tenant {
  id: number;
  unit_id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  payment_method: string;    // always 'zelle' for now
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export type TenantInsert = Omit<Tenant, 'id' | 'created_at'>;

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

export interface Lease {
  id: number;
  tenant_id: number;
  unit_id: number;

  start_date: string;        // YYYY-MM-DD
  end_date: string;          // YYYY-MM-DD

  rent_amount: number;       // whole dollars/month
  security_deposit: number | null;
  late_fee_amount: number | null;
  late_fee_grace_days: number | null;

  utilities_landlord: string | null;   // JSON string: string[]
  utilities_tenant: string | null;     // JSON string: string[]
  equipment_included: string | null;   // JSON string: string[]

  pdf_url: string | null;
  extracted_by_ai: boolean;
  ai_confidence_notes: string | null;

  created_at: string;
  updated_at: string;
}

export type LeaseInsert = Omit<Lease, 'id' | 'created_at' | 'updated_at'>;

/** Parsed version of a lease with JSON arrays deserialized */
export interface LeaseParsed extends Omit<Lease, 'utilities_landlord' | 'utilities_tenant' | 'equipment_included'> {
  utilities_landlord: string[];
  utilities_tenant: string[];
  equipment_included: string[];
}

/** Shape Claude returns when parsing a lease PDF */
export interface LeaseExtraction {
  start_date: string | null;
  end_date: string | null;
  rent_amount: number | null;
  security_deposit: number | null;
  late_fee_amount: number | null;
  late_fee_grace_days: number | null;
  utilities_landlord: string[];
  utilities_tenant: string[];
  equipment_included: string[];
  confidence_notes: string | null;   // anything Claude was unsure about
}

// ---------------------------------------------------------------------------
// Rent Collections
// ---------------------------------------------------------------------------

export type RentCollectionSource = 'manual' | 'csv_import';

export interface RentCollection {
  id: number;
  unit_id: number;
  lease_id: number | null;

  due_date: string;          // YYYY-MM-DD
  amount_due: number;

  paid_date: string | null;
  amount_paid: number | null;

  is_partial: boolean;
  is_late: boolean;
  late_fee_charged: number | null;
  late_fee_paid: number | null;

  source: RentCollectionSource;
  import_batch_id: string | null;
  notes: string | null;

  created_at: string;
  updated_at: string;
}

export type RentCollectionInsert = Omit<RentCollection, 'id' | 'created_at' | 'updated_at'>;

/** One row parsed from a BofA CSV export */
export interface BofaCsvRow {
  date: string;              // raw date string from CSV
  description: string;       // transaction description (contains tenant name / "Zelle from ...")
  amount: number;            // positive = credit (payment received)
  balance: number | null;
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export type VendorTrade =
  | 'plumbing'
  | 'hvac'
  | 'electrical'
  | 'roofing'
  | 'appliance'
  | 'landscaping'
  | 'general'
  | 'other';

export interface Vendor {
  id: number;
  name: string;
  trade: VendorTrade;
  phone: string | null;
  email: string | null;
  website: string | null;

  google_place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  google_last_refreshed: string | null;

  manual_rating: number | null;   // 1–5
  manual_notes: string | null;

  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type VendorInsert = Omit<Vendor, 'id' | 'created_at' | 'updated_at'>;

// ---------------------------------------------------------------------------
// Work Orders
// ---------------------------------------------------------------------------

export type WorkOrderStatus = 'received' | 'open' | 'complete';
export type WorkOrderCategory =
  | 'plumbing'
  | 'hvac'
  | 'electrical'
  | 'roofing'
  | 'appliance'
  | 'general'
  | 'other';
export type WorkOrderSource = 'manual' | 'pdf' | 'email_forward';

export interface WorkOrder {
  id: number;
  property_id: number;
  unit_id: number | null;
  vendor_id: number;

  category: WorkOrderCategory;
  description: string;

  status: WorkOrderStatus;
  date_received: string;     // YYYY-MM-DD
  date_started: string | null;
  date_completed: string | null;

  quoted_cost: number | null;
  actual_cost: number | null;

  rating: number | null;     // 1–5
  review_notes: string | null;

  source: WorkOrderSource;
  attachment_url: string | null;

  created_at: string;
  updated_at: string;
}

export type WorkOrderInsert = Omit<WorkOrder, 'id' | 'created_at' | 'updated_at'>;

/** Shape Claude returns when parsing a work order PDF/email */
export interface WorkOrderExtraction {
  vendor_name: string | null;
  category: WorkOrderCategory | null;
  description: string | null;
  date_received: string | null;
  quoted_cost: number | null;
  actual_cost: number | null;
  confidence_notes: string | null;
}

// ---------------------------------------------------------------------------
// Escrow Accounts
// ---------------------------------------------------------------------------

export interface EscrowAccount {
  id: number;
  property_id: number;
  lender_name: string;
  loan_number: string | null;
  notes: string | null;
  created_at: string;
}

export type EscrowAccountInsert = Omit<EscrowAccount, 'id' | 'created_at'>;

// ---------------------------------------------------------------------------
// Escrow Statements
// ---------------------------------------------------------------------------

/** A single tax or insurance disbursement within an escrow statement */
export interface EscrowDisbursement {
  date: string;              // YYYY-MM-DD
  payee: string;
  amount: number;
}

export interface EscrowStatement {
  id: number;
  escrow_account_id: number;

  statement_date: string;            // YYYY-MM-DD
  analysis_period_start: string;     // YYYY-MM-DD
  analysis_period_end: string;       // YYYY-MM-DD

  projected_requirement: number | null;
  actual_disbursements: number | null;
  shortage_surplus_amount: number | null;  // positive = surplus, negative = shortage

  new_monthly_escrow: number | null;

  tax_disbursements: string | null;         // JSON: EscrowDisbursement[]
  insurance_disbursements: string | null;   // JSON: EscrowDisbursement[]

  pdf_url: string | null;
  extracted_by_ai: boolean;
  ai_confidence_notes: string | null;

  created_at: string;
}

export type EscrowStatementInsert = Omit<EscrowStatement, 'id' | 'created_at'>;

/** Shape Claude returns when parsing an escrow analysis PDF */
export interface EscrowExtraction {
  statement_date: string | null;
  analysis_period_start: string | null;
  analysis_period_end: string | null;
  projected_requirement: number | null;
  actual_disbursements: number | null;
  shortage_surplus_amount: number | null;
  new_monthly_escrow: number | null;
  tax_disbursements: EscrowDisbursement[];
  insurance_disbursements: EscrowDisbursement[];
  confidence_notes: string | null;
}

// ---------------------------------------------------------------------------
// Insurance Policies
// ---------------------------------------------------------------------------

export type PolicyType = 'homeowners' | 'landlord' | 'liability' | 'flood' | 'umbrella' | 'other';

export interface InsurancePolicy {
  id: number;
  property_id: number;

  carrier: string;
  policy_number: string | null;
  policy_type: PolicyType | null;

  effective_date: string;      // YYYY-MM-DD
  expiration_date: string;     // YYYY-MM-DD
  renewal_period_days: number | null;

  annual_premium: number | null;
  deductible: number | null;
  coverage_limit: number | null;

  coverage_notes: string | null;   // free-form, used for Slack NLQ

  pdf_url: string | null;
  extracted_by_ai: boolean;
  ai_confidence_notes: string | null;

  created_at: string;
  updated_at: string;
}

export type InsurancePolicyInsert = Omit<InsurancePolicy, 'id' | 'created_at' | 'updated_at'>;

/** Shape Claude returns when parsing an insurance policy PDF */
export interface InsuranceExtraction {
  carrier: string | null;
  policy_number: string | null;
  policy_type: PolicyType | null;
  effective_date: string | null;
  expiration_date: string | null;
  renewal_period_days: number | null;
  annual_premium: number | null;
  deductible: number | null;
  coverage_limit: number | null;
  coverage_notes: string | null;
  confidence_notes: string | null;
}

// ---------------------------------------------------------------------------
// Shared / Utility Types
// ---------------------------------------------------------------------------

/** Enriched work order with vendor and property info joined in */
export interface WorkOrderWithContext extends WorkOrder {
  vendor_name: string;
  vendor_trade: VendorTrade;
  property_address: string;
  unit_label: string | null;
}

/** Enriched lease with tenant and unit info joined in */
export interface LeaseWithContext extends Lease {
  tenant_first_name: string;
  tenant_last_name: string;
  unit_label: string;
  property_address: string;
}

/** Rent collection with unit and property context */
export interface RentCollectionWithContext extends RentCollection {
  unit_label: string;
  property_address: string;
  tenant_name: string | null;
}

/** Summary used for the monthly recap / Slack bot */
export interface PropertySummary {
  property: OwnedProperty;
  units: Unit[];
  active_leases: LeaseWithContext[];
  rent_this_month: {
    expected: number;
    collected: number;
    outstanding: number;
    partial_count: number;
    late_count: number;
  };
  open_work_orders: WorkOrderWithContext[];
  expiring_leases_60d: LeaseWithContext[];
  unrated_work_orders: WorkOrderWithContext[];
  escrow_last_statement: EscrowStatement | null;
  insurance_expiring_60d: InsurancePolicy[];
}
