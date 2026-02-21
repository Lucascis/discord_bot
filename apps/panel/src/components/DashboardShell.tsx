'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Music,
  Library,
  Settings,
  ChevronLeft,
  Search,
} from 'lucide-react';
import type { GuildOverview } from '@/lib/guild-client';
import { useState } from 'react';

const BOT_NAME = 'NebuDJ';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' },
  { icon: Music, label: 'Player', href: '/dashboard/player' },
  { icon: Library, label: 'Library', href: '/dashboard/library' },
  { icon: Settings, label: 'Capabilities', href: '/dashboard/capabilities' },
  { icon: Settings, label: 'Settings', href: '/dashboard/settings' },
];

interface Props {
  guilds: GuildOverview[];
  currentUserId?: string;
  children: React.ReactNode;
}

export function DashboardShell({ guilds, currentUserId: _currentUserId, children }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [brokenIcons, setBrokenIcons] = useState<Set<string>>(new Set());

  const guildId = searchParams.get('guild') ?? guilds[0]?.id;
  const selectedGuild = guilds.find((g) => g.id === guildId) ?? guilds[0];

  const buildHref = (base: string) =>
    selectedGuild ? `${base}?guild=${selectedGuild.id}` : base;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={clsx(
          'flex flex-col border-r border-white/10 bg-black/40 backdrop-blur-xl transition-all duration-300',
          sidebarCollapsed ? 'w-[72px]' : 'w-[260px]'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          {!sidebarCollapsed && (
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center">
                <Music className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-white">{BOT_NAME}</span>
            </Link>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="rounded p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <ChevronLeft
              className={clsx('h-5 w-5 transition-transform', sidebarCollapsed && 'rotate-180')}
            />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          <p className={clsx('mb-3 text-[10px] font-bold uppercase tracking-widest text-white/40', sidebarCollapsed && 'text-center')}>
            {sidebarCollapsed ? '—' : 'MENU'}
          </p>
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={buildHref(item.href)}
                className={clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all',
                  isActive
                    ? 'bg-violet-500/20 text-white border border-violet-500/30'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!sidebarCollapsed && <span className="font-medium">{item.label}</span>}
              </Link>
            );
          })}

          <p className={clsx('mt-6 mb-3 text-[10px] font-bold uppercase tracking-widest text-white/40', sidebarCollapsed && 'text-center')}>
            {sidebarCollapsed ? '—' : 'YOUR SERVERS'}
          </p>
          <div className="space-y-1">
            {guilds.map((guild) => {
              const isSelected = selectedGuild?.id === guild.id;
              return (
                <Link
                  key={guild.id}
                  href={`${pathname}?guild=${guild.id}`}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all',
                    isSelected
                      ? 'bg-violet-500/20 text-white border border-violet-500/30'
                      : 'text-white/60 hover:bg-white/5 hover:text-white'
                  )}
                >
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold bg-white/10 overflow-hidden flex-shrink-0">
                    {guild.icon && !brokenIcons.has(guild.id) ? (
                      <img
                        src={guild.icon}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={() => setBrokenIcons((s) => new Set(s).add(guild.id))}
                      />
                    ) : (
                      guild.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  {!sidebarCollapsed && (
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{guild.name}</p>
                      <p className="text-[10px] text-white/40">— online</p>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

          {!sidebarCollapsed && (
            <div className="mt-6 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-900/20 to-black/40 p-4">
              <span className="text-sm font-semibold text-white">Personal Mode</span>
              <p className="mt-2 text-xs text-white/60">
                Todas las capacidades avanzadas estan habilitadas para uso privado.
              </p>
            </div>
          )}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/10 bg-black/60 backdrop-blur-xl px-6">
          <div className="flex items-center gap-4 flex-1 max-w-2xl">
            <div className="flex items-center gap-2 text-white/60">
              <span className="text-sm font-medium">{pathname === '/dashboard' ? 'Dashboard' : pathname.split('/').pop()}</span>
            </div>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="search"
                placeholder="Search for songs, artists, albums..."
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {session?.user?.image ? (
              <Image
                src={session.user.image}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-full object-cover ring-2 ring-white/10"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-violet-500/30 flex items-center justify-center text-sm font-semibold text-white">
                {session?.user?.name?.slice(0, 1) ?? '?'}
              </div>
            )}
            <span className="text-sm font-medium text-white/90 max-w-[120px] truncate hidden sm:block">
              {session?.user?.name}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
