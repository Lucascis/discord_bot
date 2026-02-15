'use client';

import { motion } from 'framer-motion';
import clsx from 'clsx';
import type { GuildOverview } from '@/lib/guild-client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SlidersHorizontal, ListMusic, CreditCard } from 'lucide-react';
import { useState } from 'react';

interface Props {
    guilds: GuildOverview[];
    selectedGuildId?: string;
    onSelect?: (guild: GuildOverview) => void;
}

export function Sidebar({ guilds, selectedGuildId, onSelect }: Props) {
    const pathname = usePathname();
    const [brokenGuildIcons, setBrokenGuildIcons] = useState<Set<string>>(new Set());
    const inviteClientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    const inviteUrl = inviteClientId
        ? `https://discord.com/oauth2/authorize?client_id=${inviteClientId}&scope=bot%20applications.commands&permissions=8`
        : null;

    const navItems = [
        { icon: SlidersHorizontal, label: 'Control Room', href: '/dashboard' },
        { icon: ListMusic, label: 'My Playlists', href: '/dashboard/playlists' },
        { icon: CreditCard, label: 'Subscription', href: '/dashboard/subscription' },
    ];

    return (
        <aside className="w-full lg:w-[280px] flex-shrink-0">
            <div className="sticky top-24 space-y-6">
                <div className="rounded-2xl border border-white/5 bg-black/40 p-4 backdrop-blur-xl">
                    <div className="mb-6 space-y-1">
                        <h2 className="px-2 text-xs font-bold uppercase tracking-wider text-white/40 mb-2">Library</h2>
                        {navItems.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={clsx(
                                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all group relative overflow-hidden",
                                        isActive
                                            ? "bg-brand-500/20 text-white border border-brand-500/30 shadow-neon-brand-sm"
                                            : "text-white/60 hover:bg-white/5 hover:text-white border border-transparent"
                                    )}
                                >
                                    {isActive && (
                                        <motion.div
                                            layoutId="active-nav"
                                            className="absolute inset-0 bg-brand-500/10"
                                            initial={false}
                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                        />
                                    )}
                                    <div className={clsx(
                                        "h-10 w-10 rounded-full flex items-center justify-center text-lg transition-transform group-hover:scale-105",
                                        isActive ? "bg-brand-500 text-white shadow-lg" : "bg-white/10 text-white/40 group-hover:bg-white/20 group-hover:text-white"
                                    )}>
                                        <item.icon size={18} />
                                    </div>
                                    <span className="font-medium relative z-10">{item.label}</span>
                                </Link>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between mb-4 px-2">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-white/40">Your Servers</h2>
                        <span className="text-xs text-white/20">{guilds.length} Active</span>
                    </div>

                    <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto custom-scrollbar pr-2">
                        {guilds.map((guild) => {
                            const isGuildActive = selectedGuildId === guild.id && !navItems.some(i => pathname === i.href);
                            return (
                                <button
                                    key={guild.id}
                                    onClick={() => onSelect?.(guild)}
                                    className={clsx(
                                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all group relative overflow-hidden",
                                        isGuildActive
                                            ? "bg-brand-500/20 text-white border border-brand-500/30 shadow-neon-brand-sm"
                                            : "text-white/60 hover:bg-white/5 hover:text-white border border-transparent"
                                    )}
                                >
                                    {isGuildActive && (
                                        <motion.div
                                            layoutId="active-nav"
                                            className="absolute inset-0 bg-brand-500/10"
                                            initial={false}
                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                        />
                                    )}

                                    <div className={clsx(
                                        "h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold transition-transform group-hover:scale-105",
                                        isGuildActive
                                            ? "bg-brand-500 text-white shadow-lg"
                                            : "bg-white/10 text-white/40 group-hover:bg-white/20 group-hover:text-white"
                                    )}>
                                        {guild.icon && !brokenGuildIcons.has(guild.id) ? (
                                            <img
                                                src={guild.icon}
                                                alt={guild.name}
                                                className="h-full w-full rounded-full object-cover"
                                                onError={() => {
                                                    setBrokenGuildIcons((current) => {
                                                        const next = new Set(current);
                                                        next.add(guild.id);
                                                        return next;
                                                    });
                                                }}
                                            />
                                        ) : (
                                            guild.name.substring(0, 2).toUpperCase()
                                        )}
                                    </div>

                                    <div className="flex-1 text-left truncate relative z-10">
                                        <p className="font-medium truncate">{guild.name}</p>
                                        {isGuildActive && (
                                            <p className="text-[10px] text-brand-200 animate-pulse">Connected</p>
                                        )}
                                    </div>
                                </button>
                            );
                        })}

                        {guilds.length === 0 && (
                            <div className="p-4 text-center rounded-xl bg-white/5 border border-white/5 border-dashed">
                                <p className="text-sm text-white/40">No hay servidores configurables para esta cuenta.</p>
                                <p className="mt-2 text-xs text-white/30">
                                    Verificá que tengas permisos de Owner o Manage Server y que el bot esté instalado.
                                </p>
                                {inviteUrl ? (
                                    <a
                                        href={inviteUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-3 block text-xs text-brand-400 hover:text-brand-300 hover:underline"
                                    >
                                        Add Bot to Server
                                    </a>
                                ) : (
                                    <p className="mt-3 text-[11px] text-white/25">
                                        Definí `NEXT_PUBLIC_DISCORD_CLIENT_ID` para mostrar el link de instalación.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-brand-900/20 to-black/40 p-4 backdrop-blur-xl">
                    <h3 className="text-sm font-semibold text-white mb-1">Need Help?</h3>
                    <p className="text-xs text-white/50 mb-3">Join our support server for assistance.</p>
                    <a
                        href="#"
                        className="block w-full py-2 text-center rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10"
                    >
                        Join Support
                    </a>
                </div>
            </div>
        </aside>
    );
}
