import type { RuntimePlan } from '@/lib/plan-client';
import { formatter } from '@/lib/utils';

interface Props {
  plans: RuntimePlan[];
}

export function PlanGrid({ plans }: Props) {
  if (plans.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-white/70">
        No pudimos cargar los planes. Configurá `NEXT_PUBLIC_API_BASE_URL` para consumir la API.
      </div>
    );
  }

  return (
    <div id="plans" className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {plans.map((plan) => (
        <article key={plan.tier} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-transparent p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-semibold">{plan.displayName ?? plan.tier}</h3>
            <span className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
              {plan.tier}
            </span>
          </div>
          <p className="mt-2 text-sm text-white/60">{plan.description ?? 'Plan sin descripción'}</p>
          <p className="mt-6 text-3xl font-bold">
            {plan.price.monthly === 0 ? 'Gratis' : formatter(plan.price.monthly)}
            <span className="text-lg text-white/60"> /mes</span>
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/80">
            {Object.entries(plan.features ?? {}).slice(0, 5).map(([key, value]) => (
              <li key={key} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                <span className="ml-auto text-white/60">{String(value)}</span>
              </li>
            ))}
          </ul>
          <button className="mt-6 w-full rounded-xl bg-brand-500/80 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-500">
            Upsell automático
          </button>
        </article>
      ))}
    </div>
  );
}
