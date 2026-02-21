'use client';

import { usePathname } from 'next/navigation';
import { Navbar } from './Navbar';

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith('/dashboard');

  if (isDashboard) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Navbar />
      {children}
    </div>
  );
}
