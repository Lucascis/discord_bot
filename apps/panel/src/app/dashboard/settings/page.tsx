import { auth } from '@/app/auth';
import { redirect } from 'next/navigation';
import { getGuilds, getGuildSettings } from '@/lib/guild-client';
import { SettingsView } from '@/components/SettingsView';

type Props = { searchParams?: Promise<{ guild?: string }> | { guild?: string } };

async function resolveParams(input: Props['searchParams']) {
  if (!input) return {};
  if (typeof (input as Promise<{ guild?: string }>).then === 'function') {
    return await (input as Promise<{ guild?: string }>);
  }
  return input as { guild?: string };
}

export default async function SettingsPage({ searchParams }: Props) {
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
        <p>Seleccioná un servidor para configurar.</p>
      </div>
    );
  }

  const settings = await getGuildSettings(selectedGuild.id, undefined, session.user.id);

  return (
    <SettingsView
      guild={selectedGuild}
      initialSettings={settings}
      currentUserId={session.user.id}
    />
  );
}
