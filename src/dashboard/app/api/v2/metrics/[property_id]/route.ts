/**
 * GET /api/v2/metrics/[property_id]
 * Returns 12-month metrics for a property:
 * - On-time payment percentage
 * - Vacancy rate
 * - Total rent collected
 * - Total rent expected
 * - Monthly cash flow (collected rent - PITI)
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ property_id: string }> },
) {
  const { property_id } = await params;

  try {
    // Get the last 12 months of rent collection data
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const start = oneYearAgo.toISOString().slice(0, 10);
    const end = today.toISOString().slice(0, 10);

    const rentRows = await query<Record<string, unknown>>(
      `SELECT rc.*,
              u.unit_label,
              u.is_owner_unit,
              (t.first_name || ' ' || t.last_name) AS tenant_name
       FROM rent_collections rc
       JOIN units u ON u.id = rc.unit_id
       LEFT JOIN LATERAL (
         SELECT * FROM tenants
         WHERE unit_id = rc.unit_id AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 1
       ) t ON TRUE
       WHERE u.property_id = $1
         AND rc.due_date >= $2
         AND rc.due_date <= $3
       ORDER BY rc.due_date DESC`,
      [property_id, start, end],
    );

    // Get PITI history for the same period
    const pitiRows = await query<Record<string, unknown>>(
      `SELECT * FROM piti_history
       WHERE property_id = $1
         AND statement_year_month >= $2
         AND statement_year_month <= $3
       ORDER BY statement_year_month DESC`,
      [property_id, start.slice(0, 7), end.slice(0, 7)],
    );

    // Get the property to find out how many rental units exist
    const propRow = await queryOne<Record<string, unknown>>(
      `SELECT p.* FROM owned_properties p WHERE p.id = $1`,
      [property_id],
    );

    const totalUnits = propRow
      ? (propRow['unit_count'] as number | null) ?? 0
      : 0;

    // Count rental units (non-owner)
    const rentalUnitsSet = new Set<number>();
    for (const row of rentRows) {
      const unitId = row['unit_id'] as number;
      const isOwner = row['is_owner_unit'] as boolean;
      if (!isOwner) {
        rentalUnitsSet.add(unitId);
      }
    }
    const rentalUnits = rentalUnitsSet.size || totalUnits - 1; // Assume 1 is owner-occupied if none found

    // Calculate metrics
    let totalExpected = 0;
    let totalCollected = 0;
    let onTimeCount = 0;
    let totalPayments = 0;

    const months: Set<string> = new Set();

    for (const row of rentRows) {
      const isOwner = row['is_owner_unit'] as boolean;
      if (isOwner) continue; // Skip owner-occupied units

      const dueDateStr = row['due_date'] as string;
      const month = dueDateStr.slice(0, 7); // YYYY-MM
      months.add(month);

      const amountDue = (row['amount_due'] as number) ?? 0;
      const amountPaid = (row['amount_paid'] as number) ?? 0;
      const isLate = (row['is_late'] as boolean) ?? false;

      totalExpected += amountDue;
      totalCollected += amountPaid;
      totalPayments++;

      if (amountPaid > 0 && !isLate) {
        onTimeCount++;
      }
    }

    // On-time percentage (only count paid/partial as on-time)
    const onTimePercent =
      totalPayments > 0 ? Math.round((onTimeCount / totalPayments) * 100) : 0;

    // Vacancy rate: percentage of rental unit-months where no payment was recorded
    // 0% = fully occupied all year, 100% = vacant all year
    // We look at how many distinct (unit, month) combos have NO rent record vs total expected
    // Simpler proxy: count unit-months with a rent record (occupied) vs total possible unit-months
    const occupiedUnitMonths = new Set<string>();
    for (const row of rentRows) {
      const isOwner = row['is_owner_unit'] as boolean;
      if (isOwner) continue;
      const unitId = row['unit_id'] as number;
      const month = (row['due_date'] as string).slice(0, 7);
      // A unit-month is occupied if it has a rent_collection record (even unpaid)
      occupiedUnitMonths.add(`${unitId}-${month}`);
    }
    // Total expected unit-months = rental units * months analyzed
    const totalExpectedUnitMonths = rentalUnits * (months.size || 1);
    const vacancyPercent = totalExpectedUnitMonths > 0
      ? Math.max(0, Math.round(((totalExpectedUnitMonths - occupiedUnitMonths.size) / totalExpectedUnitMonths) * 100))
      : 0;

    // Cash flow = collected rent - average PITI
    const avgPiti =
      pitiRows.length > 0
        ? pitiRows.reduce((sum, row) => {
            const total = (row['total_payment'] as number) ?? 0;
            return sum + total;
          }, 0) / pitiRows.length
        : 0;

    const avgMonthlyCollected =
      months.size > 0 ? totalCollected / months.size : 0;
    const monthlyNetCashFlow = avgMonthlyCollected - avgPiti;

    return NextResponse.json({
      on_time_percent: onTimePercent,
      vacancy_percent: vacancyPercent,
      total_rent_collected: totalCollected,
      total_rent_expected: totalExpected,
      monthly_average_collected: Math.round(avgMonthlyCollected),
      monthly_average_piti: Math.round(avgPiti * 100) / 100,
      monthly_net_cash_flow: Math.round(monthlyNetCashFlow * 100) / 100,
      months_analyzed: months.size,
      rental_units: rentalUnits,
      total_units: totalUnits,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Metrics error:', msg);
    return NextResponse.json(
      { error: 'Failed to calculate metrics', details: msg },
      { status: 500 },
    );
  }
}
