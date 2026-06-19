/**
 * V2 Property Management — Database Query Layer
 * Raw SQL via the existing `query` helper from src/db/index.ts.
 * All functions are typed against types-v2.ts.
 */

import { query } from './index.js';
import type {
  OwnedProperty, OwnedPropertyInsert,
  Unit, UnitInsert,
  Tenant, TenantInsert,
  Lease, LeaseInsert, LeaseWithContext,
  RentCollection, RentCollectionInsert, RentCollectionWithContext,
  Vendor, VendorInsert,
  WorkOrder, WorkOrderInsert, WorkOrderWithContext,
  EscrowAccount, EscrowAccountInsert,
  EscrowStatement, EscrowStatementInsert,
  InsurancePolicy, InsurancePolicyInsert,
  PropertySummary,
} from './types-v2.js';

const UTC_NOW = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;

// ===========================================================================
// OWNED PROPERTIES
// ===========================================================================

export async function listOwnedProperties(): Promise<OwnedProperty[]> {
  return query<OwnedProperty>(`SELECT * FROM owned_properties ORDER BY address`);
}

export async function getOwnedProperty(id: number): Promise<OwnedProperty | null> {
  const rows = await query<OwnedProperty>(
    `SELECT * FROM owned_properties WHERE id = $1`, [id]
  );
  return rows[0] ?? null;
}

export async function insertOwnedProperty(p: OwnedPropertyInsert): Promise<OwnedProperty> {
  const rows = await query<OwnedProperty>(
    `INSERT INTO owned_properties (address, city, state, zip_code, property_type, unit_count, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [p.address, p.city, p.state, p.zip_code, p.property_type, p.unit_count, p.notes]
  );
  return rows[0]!;
}

// ===========================================================================
// UNITS
// ===========================================================================

export async function listUnits(propertyId: number): Promise<Unit[]> {
  return query<Unit>(
    `SELECT * FROM units WHERE property_id = $1 ORDER BY unit_label`,
    [propertyId]
  );
}

export async function getUnit(id: number): Promise<Unit | null> {
  const rows = await query<Unit>(`SELECT * FROM units WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function insertUnit(u: UnitInsert): Promise<Unit> {
  const rows = await query<Unit>(
    `INSERT INTO units (property_id, unit_label, bedrooms, bathrooms, sqft, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [u.property_id, u.unit_label, u.bedrooms, u.bathrooms, u.sqft, u.notes]
  );
  return rows[0]!;
}

// ===========================================================================
// TENANTS
// ===========================================================================

export async function listTenants(unitId?: number): Promise<Tenant[]> {
  if (unitId !== undefined) {
    return query<Tenant>(
      `SELECT * FROM tenants WHERE unit_id = $1 ORDER BY last_name, first_name`,
      [unitId]
    );
  }
  return query<Tenant>(`SELECT * FROM tenants ORDER BY last_name, first_name`);
}

export async function getActiveTenant(unitId: number): Promise<Tenant | null> {
  const rows = await query<Tenant>(
    `SELECT * FROM tenants WHERE unit_id = $1 AND is_active = TRUE LIMIT 1`,
    [unitId]
  );
  return rows[0] ?? null;
}

export async function insertTenant(t: TenantInsert): Promise<Tenant> {
  const rows = await query<Tenant>(
    `INSERT INTO tenants (unit_id, first_name, last_name, email, phone, payment_method, is_active, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [t.unit_id, t.first_name, t.last_name, t.email, t.phone, t.payment_method, t.is_active, t.notes]
  );
  return rows[0]!;
}

export async function deactivateTenant(id: number): Promise<void> {
  await query(
    `UPDATE tenants SET is_active = FALSE WHERE id = $1`,
    [id]
  );
}

// ===========================================================================
// LEASES
// ===========================================================================

export async function listLeases(unitId: number): Promise<Lease[]> {
  return query<Lease>(
    `SELECT * FROM leases WHERE unit_id = $1 ORDER BY start_date DESC`,
    [unitId]
  );
}

export async function getActiveLease(unitId: number): Promise<Lease | null> {
  const rows = await query<Lease>(
    `SELECT * FROM leases
     WHERE unit_id = $1
       AND start_date <= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
       AND end_date   >= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
     ORDER BY start_date DESC
     LIMIT 1`,
    [unitId]
  );
  return rows[0] ?? null;
}

/** Leases expiring within the next N days — used for alerts */
export async function getLeasesExpiringSoon(days: number = 60): Promise<LeaseWithContext[]> {
  return query<LeaseWithContext>(
    `SELECT l.*,
            t.first_name  AS tenant_first_name,
            t.last_name   AS tenant_last_name,
            u.unit_label,
            p.address     AS property_address
     FROM leases l
     JOIN tenants t        ON t.id = l.tenant_id
     JOIN units u          ON u.id = l.unit_id
     JOIN owned_properties p ON p.id = u.property_id
     WHERE l.end_date BETWEEN
           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AND
           to_char((now() AT TIME ZONE 'UTC' + ($1 || ' days')::INTERVAL), 'YYYY-MM-DD')
     ORDER BY l.end_date`,
    [days]
  );
}

export async function insertLease(l: LeaseInsert): Promise<Lease> {
  const rows = await query<Lease>(
    `INSERT INTO leases
       (tenant_id, unit_id, start_date, end_date, rent_amount, security_deposit,
        late_fee_amount, late_fee_grace_days, utilities_landlord, utilities_tenant,
        equipment_included, pdf_url, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      l.tenant_id, l.unit_id, l.start_date, l.end_date, l.rent_amount,
      l.security_deposit, l.late_fee_amount, l.late_fee_grace_days,
      l.utilities_landlord, l.utilities_tenant, l.equipment_included,
      l.pdf_url, l.extracted_by_ai, l.ai_confidence_notes,
    ]
  );
  return rows[0]!;
}

export async function updateLeasePdfFields(
  id: number,
  fields: Partial<Pick<Lease, 'pdf_url' | 'extracted_by_ai' | 'ai_confidence_notes'>>
): Promise<void> {
  await query(
    `UPDATE leases SET pdf_url=$1, extracted_by_ai=$2, ai_confidence_notes=$3, updated_at=${UTC_NOW}
     WHERE id=$4`,
    [fields.pdf_url, fields.extracted_by_ai, fields.ai_confidence_notes, id]
  );
}

// ===========================================================================
// RENT COLLECTIONS
// ===========================================================================

export async function listRentCollections(unitId: number, limit = 24): Promise<RentCollection[]> {
  return query<RentCollection>(
    `SELECT * FROM rent_collections WHERE unit_id = $1 ORDER BY due_date DESC LIMIT $2`,
    [unitId, limit]
  );
}

/** Monthly summary across all units for a given month (YYYY-MM) */
export async function getRentSummaryForMonth(month: string): Promise<RentCollectionWithContext[]> {
  return query<RentCollectionWithContext>(
    `SELECT rc.*,
            u.unit_label,
            p.address AS property_address,
            (t.first_name || ' ' || t.last_name) AS tenant_name
     FROM rent_collections rc
     JOIN units u          ON u.id = rc.unit_id
     JOIN owned_properties p ON p.id = u.property_id
     LEFT JOIN tenants t   ON t.unit_id = rc.unit_id AND t.is_active = TRUE
     WHERE rc.due_date LIKE $1
     ORDER BY p.address, u.unit_label`,
    [month + '%']
  );
}

export async function insertRentCollection(r: RentCollectionInsert): Promise<RentCollection> {
  const rows = await query<RentCollection>(
    `INSERT INTO rent_collections
       (unit_id, lease_id, due_date, amount_due, paid_date, amount_paid,
        is_partial, is_late, late_fee_charged, late_fee_paid, source, import_batch_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      r.unit_id, r.lease_id, r.due_date, r.amount_due, r.paid_date, r.amount_paid,
      r.is_partial, r.is_late, r.late_fee_charged, r.late_fee_paid,
      r.source, r.import_batch_id, r.notes,
    ]
  );
  return rows[0]!;
}

export async function markRentPaid(
  id: number,
  paidDate: string,
  amountPaid: number,
  lateFeeCharged?: number,
  lateeFeePaid?: number
): Promise<void> {
  await query(
    `UPDATE rent_collections
     SET paid_date=$1, amount_paid=$2,
         is_partial = ($2 < amount_due),
         late_fee_charged=COALESCE($3, late_fee_charged),
         late_fee_paid=COALESCE($4, late_fee_paid),
         updated_at=${UTC_NOW}
     WHERE id=$5`,
    [paidDate, amountPaid, lateFeeCharged, lateeFeePaid, id]
  );
}

// ===========================================================================
// VENDORS
// ===========================================================================

export async function listVendors(activeOnly = true): Promise<Vendor[]> {
  return query<Vendor>(
    `SELECT * FROM vendors ${activeOnly ? 'WHERE is_active = TRUE' : ''} ORDER BY name`
  );
}

export async function getVendor(id: number): Promise<Vendor | null> {
  const rows = await query<Vendor>(`SELECT * FROM vendors WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function searchVendors(term: string): Promise<Vendor[]> {
  return query<Vendor>(
    `SELECT * FROM vendors WHERE name ILIKE $1 OR trade ILIKE $1 ORDER BY name`,
    [`%${term}%`]
  );
}

export async function insertVendor(v: VendorInsert): Promise<Vendor> {
  const rows = await query<Vendor>(
    `INSERT INTO vendors
       (name, trade, phone, email, website, google_place_id, google_rating,
        google_review_count, google_last_refreshed, manual_rating, manual_notes, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      v.name, v.trade, v.phone, v.email, v.website,
      v.google_place_id, v.google_rating, v.google_review_count, v.google_last_refreshed,
      v.manual_rating, v.manual_notes, v.is_active,
    ]
  );
  return rows[0]!;
}

export async function updateVendorGoogleRating(
  id: number,
  rating: number,
  reviewCount: number
): Promise<void> {
  await query(
    `UPDATE vendors SET google_rating=$1, google_review_count=$2, google_last_refreshed=${UTC_NOW}, updated_at=${UTC_NOW}
     WHERE id=$3`,
    [rating, reviewCount, id]
  );
}

export async function updateVendorManualRating(
  id: number,
  rating: number,
  notes: string | null
): Promise<void> {
  await query(
    `UPDATE vendors SET manual_rating=$1, manual_notes=$2, updated_at=${UTC_NOW} WHERE id=$3`,
    [rating, notes, id]
  );
}

// ===========================================================================
// WORK ORDERS
// ===========================================================================

export async function listWorkOrders(
  opts: { propertyId?: number; status?: string; vendorId?: number } = {}
): Promise<WorkOrderWithContext[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.propertyId) { conditions.push(`wo.property_id = $${idx++}`); params.push(opts.propertyId); }
  if (opts.status)     { conditions.push(`wo.status = $${idx++}`);      params.push(opts.status); }
  if (opts.vendorId)   { conditions.push(`wo.vendor_id = $${idx++}`);   params.push(opts.vendorId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return query<WorkOrderWithContext>(
    `SELECT wo.*,
            v.name  AS vendor_name,
            v.trade AS vendor_trade,
            p.address AS property_address,
            u.unit_label
     FROM work_orders wo
     JOIN vendors v          ON v.id = wo.vendor_id
     JOIN owned_properties p ON p.id = wo.property_id
     LEFT JOIN units u       ON u.id = wo.unit_id
     ${where}
     ORDER BY wo.date_received DESC`,
    params
  );
}

/** Completed work orders with no rating yet — used for proactive alerts */
export async function getUnratedCompletedWorkOrders(): Promise<WorkOrderWithContext[]> {
  return query<WorkOrderWithContext>(
    `SELECT wo.*,
            v.name  AS vendor_name,
            v.trade AS vendor_trade,
            p.address AS property_address,
            u.unit_label
     FROM work_orders wo
     JOIN vendors v          ON v.id = wo.vendor_id
     JOIN owned_properties p ON p.id = wo.property_id
     LEFT JOIN units u       ON u.id = wo.unit_id
     WHERE wo.status = 'complete' AND wo.rating IS NULL
     ORDER BY wo.date_completed DESC`
  );
}

export async function insertWorkOrder(w: WorkOrderInsert): Promise<WorkOrder> {
  const rows = await query<WorkOrder>(
    `INSERT INTO work_orders
       (property_id, unit_id, vendor_id, category, description, status,
        date_received, date_started, date_completed, quoted_cost, actual_cost,
        rating, review_notes, source, attachment_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      w.property_id, w.unit_id, w.vendor_id, w.category, w.description, w.status,
      w.date_received, w.date_started, w.date_completed,
      w.quoted_cost, w.actual_cost, w.rating, w.review_notes,
      w.source, w.attachment_url,
    ]
  );
  return rows[0]!;
}

export async function updateWorkOrderStatus(
  id: number,
  status: 'received' | 'open' | 'complete',
  dateField?: { date_started?: string; date_completed?: string }
): Promise<void> {
  await query(
    `UPDATE work_orders
     SET status=$1,
         date_started    = COALESCE($2, date_started),
         date_completed  = COALESCE($3, date_completed),
         updated_at=${UTC_NOW}
     WHERE id=$4`,
    [status, dateField?.date_started, dateField?.date_completed, id]
  );
}

export async function rateWorkOrder(
  id: number,
  rating: number,
  notes: string | null
): Promise<void> {
  await query(
    `UPDATE work_orders SET rating=$1, review_notes=$2, updated_at=${UTC_NOW} WHERE id=$3`,
    [rating, notes, id]
  );
}

// ===========================================================================
// ESCROW ACCOUNTS
// ===========================================================================

export async function listEscrowAccounts(propertyId?: number): Promise<EscrowAccount[]> {
  if (propertyId !== undefined) {
    return query<EscrowAccount>(
      `SELECT * FROM escrow_accounts WHERE property_id = $1 ORDER BY lender_name`,
      [propertyId]
    );
  }
  return query<EscrowAccount>(`SELECT * FROM escrow_accounts ORDER BY lender_name`);
}

export async function insertEscrowAccount(e: EscrowAccountInsert): Promise<EscrowAccount> {
  const rows = await query<EscrowAccount>(
    `INSERT INTO escrow_accounts (property_id, lender_name, loan_number, notes)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (property_id, loan_number) DO UPDATE SET lender_name=EXCLUDED.lender_name
     RETURNING *`,
    [e.property_id, e.lender_name, e.loan_number, e.notes]
  );
  return rows[0]!;
}

// ===========================================================================
// ESCROW STATEMENTS
// ===========================================================================

export async function listEscrowStatements(escrowAccountId: number): Promise<EscrowStatement[]> {
  return query<EscrowStatement>(
    `SELECT * FROM escrow_statements WHERE escrow_account_id = $1 ORDER BY statement_date DESC`,
    [escrowAccountId]
  );
}

export async function getLatestEscrowStatement(escrowAccountId: number): Promise<EscrowStatement | null> {
  const rows = await query<EscrowStatement>(
    `SELECT * FROM escrow_statements WHERE escrow_account_id = $1 ORDER BY statement_date DESC LIMIT 1`,
    [escrowAccountId]
  );
  return rows[0] ?? null;
}

export async function insertEscrowStatement(s: EscrowStatementInsert): Promise<EscrowStatement> {
  const rows = await query<EscrowStatement>(
    `INSERT INTO escrow_statements
       (escrow_account_id, statement_date, analysis_period_start, analysis_period_end,
        projected_requirement, actual_disbursements, shortage_surplus_amount,
        new_monthly_escrow, tax_disbursements, insurance_disbursements,
        pdf_url, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      s.escrow_account_id, s.statement_date, s.analysis_period_start, s.analysis_period_end,
      s.projected_requirement, s.actual_disbursements, s.shortage_surplus_amount,
      s.new_monthly_escrow, s.tax_disbursements, s.insurance_disbursements,
      s.pdf_url, s.extracted_by_ai, s.ai_confidence_notes,
    ]
  );
  return rows[0]!;
}

// ===========================================================================
// INSURANCE POLICIES
// ===========================================================================

export async function listInsurancePolicies(propertyId?: number): Promise<InsurancePolicy[]> {
  if (propertyId !== undefined) {
    return query<InsurancePolicy>(
      `SELECT * FROM insurance_policies WHERE property_id = $1 ORDER BY expiration_date DESC`,
      [propertyId]
    );
  }
  return query<InsurancePolicy>(`SELECT * FROM insurance_policies ORDER BY expiration_date DESC`);
}

/** Policies expiring within N days — used for alerts */
export async function getInsurancePoliciesExpiringSoon(days = 60): Promise<InsurancePolicy[]> {
  return query<InsurancePolicy>(
    `SELECT ip.*, p.address AS property_address
     FROM insurance_policies ip
     JOIN owned_properties p ON p.id = ip.property_id
     WHERE ip.expiration_date BETWEEN
           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AND
           to_char((now() AT TIME ZONE 'UTC' + ($1 || ' days')::INTERVAL), 'YYYY-MM-DD')
     ORDER BY ip.expiration_date`,
    [days]
  );
}

export async function insertInsurancePolicy(p: InsurancePolicyInsert): Promise<InsurancePolicy> {
  const rows = await query<InsurancePolicy>(
    `INSERT INTO insurance_policies
       (property_id, carrier, policy_number, policy_type, effective_date, expiration_date,
        renewal_period_days, annual_premium, deductible, coverage_limit,
        coverage_notes, pdf_url, extracted_by_ai, ai_confidence_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      p.property_id, p.carrier, p.policy_number, p.policy_type,
      p.effective_date, p.expiration_date, p.renewal_period_days,
      p.annual_premium, p.deductible, p.coverage_limit,
      p.coverage_notes, p.pdf_url, p.extracted_by_ai, p.ai_confidence_notes,
    ]
  );
  return rows[0]!;
}

// ===========================================================================
// PROPERTY SUMMARY (used by monthly recap + Slack bot)
// ===========================================================================

export async function buildPropertySummary(propertyId: number): Promise<PropertySummary | null> {
  const property = await getOwnedProperty(propertyId);
  if (!property) return null;

  const units = await listUnits(propertyId);

  // Active leases with context
  const activeLeases: LeaseWithContext[] = [];
  for (const u of units) {
    const lease = await getActiveLease(u.id);
    if (lease) {
      activeLeases.push({
        ...lease,
        tenant_first_name: '',   // filled below
        tenant_last_name: '',
        unit_label: u.unit_label,
        property_address: property.address,
      });
    }
  }

  // Rent this month
  const thisMonth = new Date().toISOString().slice(0, 7);   // YYYY-MM
  const rentRows = await getRentSummaryForMonth(thisMonth);
  const propertyRentRows = rentRows.filter(r =>
    units.some(u => u.id === r.unit_id)
  );
  const expected    = propertyRentRows.reduce((s, r) => s + r.amount_due, 0);
  const collected   = propertyRentRows.reduce((s, r) => s + (r.amount_paid ?? 0), 0);
  const outstanding = expected - collected;
  const partialCount = propertyRentRows.filter(r => r.is_partial).length;
  const lateCount    = propertyRentRows.filter(r => r.is_late).length;

  // Open work orders
  const openWorkOrders = await listWorkOrders({ propertyId, status: 'open' });

  // Expiring leases (60d) for this property
  const allExpiring = await getLeasesExpiringSoon(60);
  const expiringLeases = allExpiring.filter(l => l.property_address === property.address);

  // Unrated completed WOs for this property
  const allUnrated = await getUnratedCompletedWorkOrders();
  const unratedWOs = allUnrated.filter(w => w.property_id === propertyId);

  // Latest escrow statement
  const escrowAccounts = await listEscrowAccounts(propertyId);
  let latestEscrow: EscrowStatement | null = null;
  if (escrowAccounts.length > 0) {
    latestEscrow = await getLatestEscrowStatement(escrowAccounts[0]!.id);
  }

  // Insurance expiring soon for this property
  const allInsuranceExpiring = await getInsurancePoliciesExpiringSoon(60);
  const insuranceExpiring = allInsuranceExpiring.filter(p => p.property_id === propertyId);

  return {
    property,
    units,
    active_leases: activeLeases,
    rent_this_month: {
      expected,
      collected,
      outstanding,
      partial_count: partialCount,
      late_count: lateCount,
    },
    open_work_orders: openWorkOrders,
    expiring_leases_60d: expiringLeases,
    unrated_work_orders: unratedWOs,
    escrow_last_statement: latestEscrow,
    insurance_expiring_60d: insuranceExpiring,
  };
}
