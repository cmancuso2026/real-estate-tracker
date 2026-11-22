import type { Metadata } from 'next';
import { FinanceShell } from '@/components/finance/FinanceShell';

export const metadata: Metadata = { title: 'Finances' };

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <FinanceShell>{children}</FinanceShell>;
}
