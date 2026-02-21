import { redirect } from 'next/navigation';
import { auth } from '@/app/auth';
import { isStaffDiscordId } from '@/lib/staff';
import { getPlatformHealth } from '@/lib/health-client';
import { MonitoringPanel } from '@/components/MonitoringPanel';
import { OperationsStatus } from '@/components/OperationsStatus';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  const session = await auth();
  if (!session?.user?.id || !isStaffDiscordId(session.user.id)) {
    redirect('/');
  }

  const health = await getPlatformHealth();

  return (
    <main className="flex flex-col gap-8 py-6">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-white/40">Control Operativo</p>
        <h1 className="mt-2 text-4xl font-bold">Panel interno operativo</h1>
        <p className="text-white/70">
          La edicion comercial fue removida. Esta vista queda dedicada a monitoreo y estado de servicios para el modo personal.
        </p>
      </div>
      <MonitoringPanel health={health} />
      <OperationsStatus health={health} />
    </main>
  );
}
