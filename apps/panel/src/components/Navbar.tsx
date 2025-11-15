'use client';

import Link from 'next/link';
import { useSession, signIn, signOut } from 'next-auth/react';

export function Navbar() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated' && session?.user;
  const isStaff = Boolean(session?.user?.isStaff);

  return (
    <header className="mb-8 flex items-center justify-between rounded-2xl border border-white/5 bg-black/40 px-6 py-4">
      <Link href="/" className="text-lg font-semibold">
        Discord Music Panel
      </Link>
      <nav className="flex items-center gap-4 text-sm text-white/70">
        <Link href="#plans" className="hover:text-white">Planes</Link>
        <Link href="#roadmap" className="hover:text-white">Roadmap</Link>
        {isAuthenticated && (
          <Link href="/dashboard" className="hover:text-white">
            Mi panel
          </Link>
        )}
        {isAuthenticated && isStaff && (
          <Link href="/admin/plans" className="hover:text-white">
            Plan Engine
          </Link>
        )}
        {isAuthenticated ? (
          <div className="flex items-center gap-3">
            {session.user?.image ? (
              <img src={session.user.image} alt="avatar" className="h-8 w-8 rounded-full border border-white/20 object-cover" />
            ) : (
              <div className="h-8 w-8 rounded-full border border-white/20 bg-white/10" />
            )}
            <span>{session.user?.name ?? 'Usuario'}</span>
            <button
              onClick={() => signOut()}
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/10"
            >
              Cerrar sesión
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn('discord')}
            className="rounded-full bg-brand-500/80 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-500"
          >
            Ingresar con Discord
          </button>
        )}
      </nav>
    </header>
  );
}
