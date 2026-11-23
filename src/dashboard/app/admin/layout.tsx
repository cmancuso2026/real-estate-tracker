import type { Metadata } from 'next';
import { AdminNav } from '@/components/admin/AdminNav';

export const metadata: Metadata = { title: 'Admin' };

/** Admin portal: one place for categories, rules, mappings, data and settings. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-[13rem_1fr]">
      <aside className="space-y-3">
        <h1 className="px-3 text-lg font-bold">Admin</h1>
        <AdminNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
