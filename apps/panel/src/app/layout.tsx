import type { Metadata } from 'next';
import '../styles/globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Discord Music Control Panel',
  description: 'Panel personal con control musical completo y monitoreo en tiempo real.'
};

import { LayoutWrapper } from '@/components/LayoutWrapper';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <LayoutWrapper>{children}</LayoutWrapper>
        </Providers>
      </body>
    </html>
  );
}
