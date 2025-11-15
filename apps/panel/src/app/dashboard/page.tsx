import { redirect } from 'next/navigation';
import { auth } from '@/app/auth';
import { getGuilds, getGuildSettings } from '@/lib/guild-client';
import { getGuildAnalytics } from '@/lib/analytics-client';
import { GuildDashboard } from '@/components/GuildDashboard';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const guildResponse = await getGuilds();
  const guilds = guildResponse.data;
  const selectedGuild = guilds[0] ?? null;
  const [settings, analytics] = selectedGuild
    ? await Promise.all([
        getGuildSettings(selectedGuild.id),
        getGuildAnalytics(selectedGuild.id)
      ])
    : [null, null];

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
      />
    </main>
  );
}
