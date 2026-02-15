import { auth } from '@/app/auth';
import { redirect } from 'next/navigation';
import { getGuilds } from '@/lib/guild-client';
import { PlaylistsClient } from './PlaylistsClient';

export default async function PlaylistsPage() {
    const session = await auth();
    if (!session?.user) {
        redirect('/');
    }

    const guildResponse = await getGuilds(undefined, session.user.id).catch(() => null);
    const guilds = Array.isArray(guildResponse?.data) ? guildResponse.data : [];

    return (
        <main className="flex flex-col gap-8 py-6 h-[calc(100vh-100px)]">
            <div>
                <p className="text-xs uppercase tracking-[0.4em] text-white/40">Panel Premium</p>
                <h1 className="mt-2 text-4xl font-bold">Your Library</h1>
                <p className="text-white/70">Manage your collaborative playlists and collections.</p>
            </div>

            <PlaylistsClient guilds={guilds} />
        </main>
    );
}
