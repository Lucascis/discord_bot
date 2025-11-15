import type { Metadata } from 'next';
import '../styles/globals.css';
import { Providers } from '@/components/Providers';
import { Navbar } from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'Discord Music Control Panel',
  description: 'Panel premium con planes centralizados y monitoreo en tiempo real.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <div className="mx-auto max-w-6xl px-4 py-6">
            <Navbar />
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
