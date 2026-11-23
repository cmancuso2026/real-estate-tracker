import { exportTransactionsCsv } from '@finance/services/admin.js';
import { financeDb } from '@/lib/finance';

export const dynamic = 'force-dynamic';

// GET /api/admin/export/transactions — CSV with property, unit and project columns.
export async function GET() {
  try {
    const csv = await exportTransactionsCsv(financeDb());
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="transactions-${day}.csv"`,
      },
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
