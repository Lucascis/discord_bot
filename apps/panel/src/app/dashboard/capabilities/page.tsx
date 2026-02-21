import { auth } from '@/app/auth';
import { redirect } from 'next/navigation';
import { getGuilds } from '@/lib/guild-client';
import { getAudioQualityMatrix } from '@/lib/capabilities-client';
import { CapabilitiesContent } from '@/components/CapabilitiesContent';

export default async function CapabilitiesPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const guildResponse = await getGuilds(undefined, session.user.id).catch(() => null);
  const guilds = Array.isArray(guildResponse?.data) ? guildResponse.data : [];
  const qualityMatrix = await getAudioQualityMatrix();

  return <CapabilitiesContent guilds={guilds} qualityMatrix={qualityMatrix} noSidebar />;
}
