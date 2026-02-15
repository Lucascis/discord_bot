import { redirect } from 'next/navigation';
import { auth } from '@/app/auth';
import { getGuilds, getGuildSettings } from '@/lib/guild-client';
import { getGuildAnalytics } from '@/lib/analytics-client';
import { getNowPlaying } from '@/lib/player-client';
import { GuildDashboard } from '@/components/GuildDashboard';

type DashboardPageProps = {
  searchParams?: Promise<{ guild?: string }> | { guild?: string };
};

async function resolveSearchParams(input: DashboardPageProps['searchParams']): Promise<{ guild?: string }> {
  if (!input) return {};
  if (typeof (input as Promise<{ guild?: string }>).then === 'function') {
    return await (input as Promise<{ guild?: string }>);
  }
  return input as { guild?: string };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const params = await resolveSearchParams(searchParams);
  const requestedGuildId = typeof params.guild === 'string' && params.guild.trim().length > 0
    ? params.guild.trim()
    : undefined;
  const panelApiKey = '';
  const guildResponse = await getGuilds(undefined, session.user.id).catch(() => null);
  const guilds = Array.isArray(guildResponse?.data) ? guildResponse.data : [];
  const selectedGuild = requestedGuildId
    ? guilds.find((guild) => guild.id === requestedGuildId) ?? guilds[0] ?? null
    : guilds[0] ?? null;
  const [settings, analytics, initialNowPlaying] = selectedGuild
    ? await Promise.all([
        getGuildSettings(selectedGuild.id, undefined, session.user.id),
        getGuildAnalytics(selectedGuild.id, 'week'),
        getNowPlaying(selectedGuild.id)
      ])
    : [null, null, null];

  return (
    <main className="flex flex-col gap-8 py-6">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-white/40">Panel Premium</p>
        <h1 className="mt-2 text-4xl font-bold">Tus servidores conectados</h1>
        <p className="text-white/70">Gestioná Studio Mode, límites y métricas en tiempo real usando tu cuenta de Discord.</p>
      </div>

      <GuildDashboard
        initialGuilds={guilds}
        initialSettings={settings}
        initialAnalytics={analytics}
        initialNowPlaying={initialNowPlaying}
        initialSelectedGuildId={selectedGuild?.id}
        panelApiKey={panelApiKey}
        currentUserId={session.user.id}
      />
    </main>
  );
}
