import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Delete the account and cascade to statements
  await query(`DELETE FROM escrow_accounts WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
