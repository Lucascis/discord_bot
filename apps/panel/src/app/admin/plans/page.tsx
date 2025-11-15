import { redirect } from 'next/navigation';
import { auth } from '@/app/auth';
import { PlanAdminPanel } from '@/components/PlanAdminPanel';
import { getAdminPlans } from '@/lib/admin-plan-client';
import { isStaffDiscordId } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  const session = await auth();
  if (!session?.user?.id || !isStaffDiscordId(session.user.id)) {
    redirect('/');
  }

  const plans = await getAdminPlans();

  return (
    <main className="flex flex-col gap-8 py-6">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-white/40">Control Operativo</p>
        <h1 className="mt-2 text-4xl font-bold">Plan Engine en vivo</h1>
        <p className="text-white/70">
          Administrá planes, precios y experimentos directamente sobre la base de datos. Cada cambio impacta en todos los servicios sin
          reiniciar pods gracias al recargado dinámico del runtime.
        </p>
      </div>
      <PlanAdminPanel initialPlans={plans} />
    </main>
  );
}
