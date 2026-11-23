import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/NavLinks';

export const metadata: Metadata = {
  title: { default: 'Mancuso HQ', template: '%s · Mancuso HQ' },
  description: 'Personal finances, rental properties and investing in one place',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
          <SiteHeader />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
