import { Hero } from '@/components/Hero';
import { PlanGrid } from '@/components/PlanGrid';
import { Differentiators } from '@/components/Differentiators';
import { MonitoringPanel } from '@/components/MonitoringPanel';
import { RoadmapTimeline } from '@/components/RoadmapTimeline';
import { getRuntimePlans, getDatabasePlans } from '@/lib/plan-client';

export default async function Page() {
  const [plans, dbPlans] = await Promise.all([getRuntimePlans(), getDatabasePlans()]);

  return (
    <main className="flex min-h-screen flex-col gap-12 py-6">
      <Hero />

      <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          <h2 className="text-3xl font-semibold">Planes conectados a la base</h2>
          <p className="text-white/70">
            Datos en vivo desde `/api/v1/plans/runtime`. Cada cambio en la base impacta aquí en segundos gracias al cache del paquete `@discord-bot/subscription`.
          </p>
          <PlanGrid plans={plans} />
        </div>
        <MonitoringPanel />
      </section>

      <Differentiators />

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-2xl font-semibold">Conexión directa a la DB</h2>
        <p className="text-white/70">Planes registrados actualmente:</p>
        <ul className="mt-4 space-y-2 text-sm text-white/80">
          {dbPlans.map((plan) => (
            <li key={plan.tierName} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2">
              <span>{plan.tierName}</span>
              <span className="text-white/60">{plan.prices.map((price) => `${price.provider}:${price.providerPriceId}`).join(', ') || 'Sin precios'}</span>
            </li>
          ))}
          {dbPlans.length === 0 && <li className="text-white/50">No hay registros. Ejecutá `pnpm db:seed` o crea planes desde el panel interno.</li>}
        </ul>
      </section>

      <RoadmapTimeline />
    </main>
  );
}
