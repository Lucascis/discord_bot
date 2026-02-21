import { redirect } from 'next/navigation';
import { auth } from '@/app/auth';
import { getGuilds } from '@/lib/guild-client';
import { DashboardShell } from '@/components/DashboardShell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/');
  }

  const guildResponse = await getGuilds(undefined, session.user.id).catch(() => null);
  const guilds = Array.isArray(guildResponse?.data) ? guildResponse.data : [];

  return (
    <DashboardShell guilds={guilds} currentUserId={session.user.id}>
      {children}
    </DashboardShell>
  );
}
