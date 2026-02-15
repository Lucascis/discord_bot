'use client';

import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { PlaylistManager } from '@/components/PlaylistManager';
import type { GuildOverview } from '@/lib/guild-client';

interface Props {
    guilds: GuildOverview[];
}

export function PlaylistsClient({ guilds }: Props) {
    const router = useRouter();

    const handleGuildSelect = (guild: GuildOverview) => {
        router.push(`/dashboard?guild=${guild.id}`);
    };

    return (
        <div className="flex gap-6 flex-1 min-h-0">
            <Sidebar
                guilds={guilds}
                selectedGuildId={undefined}
                onSelect={handleGuildSelect}
            />

            <div className="flex-1 min-w-0">
                <PlaylistManager />
            </div>
        </div>
    );
}
