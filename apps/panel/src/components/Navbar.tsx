'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

export function Navbar() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated' && session?.user;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-50 mb-8 flex items-center justify-between rounded-2xl border border-brand-300/20 bg-black/65 px-6 py-4 backdrop-blur-xl shadow-lg shadow-brand-950/40 transition-all">
      <div className="flex items-center gap-8">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="h-8 w-8 rounded-lg border border-brand-200/40 bg-gradient-to-br from-brand-300 to-brand-700 shadow-neon-brand group-hover:scale-105 transition-transform" />
          <span className="text-lg font-bold font-display tracking-tight">
            Discord<span className="text-brand-300">Bot</span>
          </span>
        </Link>

        {isAuthenticated && (
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/dashboard"
              className={clsx(
                "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                pathname === '/dashboard'
                  ? "bg-brand-500/25 text-white border border-brand-400/30"
                  : "text-white/65 hover:text-white hover:bg-white/5"
              )}
            >
              Dashboard
            </Link>
          </nav>
        )}
      </div>

      <div className="flex items-center gap-4">
        {isAuthenticated ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 pl-1 pr-4 py-1 hover:bg-white/10 transition-colors"
            >
              {session.user?.image ? (
                <Image
                  src={session.user.image}
                  alt="Avatar"
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-black"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-brand-500/20 ring-2 ring-black" />
              )}
              <span className="text-sm font-medium text-white/90 max-w-[100px] truncate">
                {session.user?.name}
              </span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-2xl border border-white/10 bg-[#0A0A0A] p-2 shadow-2xl ring-1 ring-black/5 focus:outline-none animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-2 border-b border-white/5 mb-1">
                  <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">Account</p>
                </div>
                <Link
                  href="/dashboard"
                  className="block rounded-xl px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <button
                  onClick={() => signOut()}
                  className="mt-1 w-full text-left rounded-xl px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => signIn('discord')}
            className="rounded-full bg-white text-black px-6 py-2.5 text-sm font-bold hover:bg-gray-200 transition-colors shadow-lg shadow-white/10"
          >
            Login with Discord
          </button>
        )}
      </div>
    </header>
  );
}
