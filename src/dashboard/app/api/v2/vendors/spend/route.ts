import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface SpendRow {
  vendor_id: number;
  vendor_name: string;
  trade: string | null;
  project_id: number;
  property_id: number;
  address: string;
  amount: string | number | null;
  activity_date: string | null;
}

interface UnitRow {
  project_id: number;
  unit_id: number;
  unit_label: string;
  cost_share: string | number | null;
}

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('propertyId');

  try {
    const spendRows = await query<SpendRow>(
      `SELECT pq.vendor_id, v.name AS vendor_name, v.trade,
              w.id AS project_id, w.property_id, op.address,
              COALESCE(pq.final_cost, pq.quoted_cost) AS amount,
              COALESCE(w.updated_at, w.created_at) AS activity_date
       FROM project_quotes pq
       JOIN work_orders w ON w.id = pq.project_id
       JOIN vendors v ON v.id = pq.vendor_id
       JOIN owned_properties op ON op.id = w.property_id
       WHERE pq.is_selected = TRUE
         ${propertyId ? 'AND w.property_id = $1' : ''}`,
      propertyId ? [propertyId] : []
    );

    const unitRows = await query<UnitRow>(
      `SELECT pu.project_id, pu.unit_id, u.unit_label, pu.cost_share
       FROM project_units pu
       JOIN units u ON u.id = pu.unit_id
       JOIN work_orders w ON w.id = pu.project_id
       JOIN project_quotes pq ON pq.project_id = w.id AND pq.is_selected = TRUE
       ${propertyId ? 'WHERE w.property_id = $1' : ''}`,
      propertyId ? [propertyId] : []
    );

    // Units assigned to each project
    const unitsByProject = new Map<number, UnitRow[]>();
    for (const u of unitRows) {
      const arr = unitsByProject.get(u.project_id) ?? [];
      arr.push(u);
      unitsByProject.set(u.project_id, arr);
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Vendors grouping
    const vendorMap = new Map<number, {
      vendor_id: number;
      vendor_name: string;
      trade: string | null;
      total_spend: number;
      last_90_days_spend: number;
      last_active_date: string | null;
    }>();

    // Properties grouping
    const propMap = new Map<number, {
      property_id: number;
      address: string;
      total_spend: number;
      units: Map<number, { unit_id: number; unit_label: string; total_spend: number }>;
    }>();

    for (const r of spendRows) {
      const amount = Number(r.amount) || 0;
      const activity = r.activity_date ? r.activity_date.slice(0, 10) : null;

      // --- vendor aggregation ---
      let v = vendorMap.get(r.vendor_id);
      if (!v) {
        v = { vendor_id: r.vendor_id, vendor_name: r.vendor_name, trade: r.trade, total_spend: 0, last_90_days_spend: 0, last_active_date: null };
        vendorMap.set(r.vendor_id, v);
      }
      v.total_spend += amount;
      if (activity && activity >= cutoffStr) v.last_90_days_spend += amount;
      if (activity && (!v.last_active_date || activity > v.last_active_date)) v.last_active_date = activity;

      // --- property aggregation ---
      let p = propMap.get(r.property_id);
      if (!p) {
        p = { property_id: r.property_id, address: r.address, total_spend: 0, units: new Map() };
        propMap.set(r.property_id, p);
      }
      p.total_spend += amount;

      const projUnits = unitsByProject.get(r.project_id) ?? [];
      if (projUnits.length > 0) {
        for (const pu of projUnits) {
          const share = pu.cost_share != null
            ? amount * (Number(pu.cost_share) / 100)
            : amount / projUnits.length;
          let um = p.units.get(pu.unit_id);
          if (!um) {
            um = { unit_id: pu.unit_id, unit_label: pu.unit_label, total_spend: 0 };
            p.units.set(pu.unit_id, um);
          }
          um.total_spend += share;
        }
      }
    }

    const vendors = Array.from(vendorMap.values()).sort((a, b) => {
      if (!a.last_active_date) return 1;
      if (!b.last_active_date) return -1;
      return a.last_active_date < b.last_active_date ? 1 : a.last_active_date > b.last_active_date ? -1 : 0;
    });

    const by_property = Array.from(propMap.values()).map((p) => ({
      property_id: p.property_id,
      address: p.address,
      total_spend: p.total_spend,
      units: Array.from(p.units.values()),
    }));

    return NextResponse.json({ vendors, by_property });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Failed to compute vendor spend', details: msg }, { status: 500 });
  }
}
