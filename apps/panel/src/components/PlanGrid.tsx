import Link from 'next/link';
import type { RuntimePlan } from '@/lib/plan-client';
import { formatter } from '@/lib/utils';

interface Props {
  plans: RuntimePlan[];
}

const FEATURE_MATRIX = [
  { key: 'concurrentPlaybacks', label: 'Instancias simultáneas (guilds distintas)' },
  { key: 'audioQuality', label: 'Calidad de audio' },
  { key: 'supportLevel', label: 'Soporte' },
  { key: 'customBranding', label: 'Branding' },
  { key: 'autoplayEnabled', label: 'Autoplay' }
] as const;

const tierHighlights: Record<string, string> = {
  pro: 'Plan recomendado: 3 instancias simultáneas en distintos servers',
  plus: 'Incluye audio dual y control desde el panel'
};

function formatFeatureValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Incluido' : 'No incluido';
  if (typeof value === 'number') {
    if (value === -1) return 'Ilimitado';
    return value.toString();
  }
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return (value as string) ?? '—';
}

export function PlanGrid({ plans }: Props) {
  if (plans.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-white/70">
        Estamos preparando los paquetes finales. Volvé en unos minutos o escribinos para activarte la mejor opción según tu uso.
      </div>
    );
  }

  const recommendedTier = plans.find((plan) => plan.tier.toLowerCase() === 'pro')?.tier ?? plans[0].tier;

  return (
    <div id="plans" className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {plans.map((plan) => {
        const monthly = plan.price?.monthly ?? 0;
        const yearly = plan.price?.yearly ?? 0;
        const isRecommended = plan.tier === recommendedTier;
        const highlightCopy = tierHighlights[plan.tier.toLowerCase()] ?? null;
        return (
          <article
            key={plan.tier}
            className={`flex h-full flex-col rounded-2xl border p-6 ${isRecommended ? 'border-brand-500/70 bg-gradient-to-b from-brand-500/15 to-transparent shadow-lg shadow-brand-500/20' : 'border-white/10 bg-gradient-to-b from-white/10 to-transparent'}`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-semibold">{plan.displayName ?? plan.tier}</h3>
              <span className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
                {plan.tier}
              </span>
            </div>
            <p className="mt-2 text-sm text-white/60">{plan.description ?? 'Plan sin descripción'}</p>
            {highlightCopy && <p className="mt-2 text-xs uppercase tracking-[0.3em] text-brand-200">{highlightCopy}</p>}
            <div className="mt-6 space-y-1">
              <p className="text-3xl font-bold">
                {monthly === 0 ? 'Gratis' : formatter(monthly)}
                <span className="text-lg text-white/60"> /mes</span>
              </p>
              {yearly > 0 && (
                <p className="text-sm text-white/60">
                  {formatter(yearly)} /año · {Math.max(0, Math.round(((monthly * 12) - yearly) / (monthly * 12 || 1) * 100))}% off
                </p>
              )}
            </div>
            <ul className="mt-4 space-y-2 text-sm text-white/80">
              {FEATURE_MATRIX.map((feature) => (
                <li key={`${plan.tier}-${feature.key}`} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>{feature.label}</span>
                  <span className="ml-auto text-white/60">
                    {formatFeatureValue(plan.features?.[feature.key] ?? plan.limits?.[feature.key])}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href={`/dashboard?plan=${encodeURIComponent(plan.tier)}`}
              className={`mt-6 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition ${isRecommended ? 'bg-brand-500 text-white hover:bg-brand-400' : 'border border-white/20 text-white hover:bg-white/10'}`}
            >
              Activar {plan.displayName ?? plan.tier}
            </Link>
            <p className="mt-2 text-[11px] text-white/50">
              Nota: 1 instancia por guild (Discord no permite más). Plus/Pro habilitan más instancias en distintos guilds.
            </p>
          </article>
        );
      })}
    </div>
  );
}
