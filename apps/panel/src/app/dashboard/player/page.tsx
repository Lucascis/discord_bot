import { redirect } from 'next/navigation';
import { auth } from '@/app/auth';
import { getGuilds, getGuildSettings } from '@/lib/guild-client';
import { getNowPlaying } from '@/lib/player-client';
import { PlayerView } from '@/components/PlayerView';

type Props = { searchParams?: Promise<{ guild?: string }> | { guild?: string } };

async function resolveParams(input: Props['searchParams']) {
  if (!input) return {};
  if (typeof (input as Promise<{ guild?: string }>).then === 'function') {
    return await (input as Promise<{ guild?: string }>);
  }
  return input as { guild?: string };
}

export default async function PlayerPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const params = await resolveParams(searchParams);
  const guildId = typeof params.guild === 'string' ? params.guild.trim() : undefined;
  const guildResponse = await getGuilds(undefined, session.user.id).catch(() => null);
  const guilds = Array.isArray(guildResponse?.data) ? guildResponse.data : [];
  const selectedGuild = guildId ? guilds.find((g) => g.id === guildId) ?? guilds[0] : guilds[0];

  if (!selectedGuild) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-white/50">
        <p>Seleccioná un servidor para ver el reproductor.</p>
      </div>
    );
  }

  const [settings, nowPlaying] = await Promise.all([
    getGuildSettings(selectedGuild.id, undefined, session.user.id),
    getNowPlaying(selectedGuild.id),
  ]);

  return (
    <PlayerView
      guild={selectedGuild}
      initialNowPlaying={nowPlaying}
      initialSettings={settings}
      panelApiKey=""
      currentUserId={session.user.id}
    />
  );
}
