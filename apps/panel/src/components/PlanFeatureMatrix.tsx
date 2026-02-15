import type { RuntimePlan } from '@/lib/plan-client';

const FEATURE_KEYS: Array<{ key: string; label: string }> = [
  { key: 'concurrentPlaybacks', label: 'Reproducciones simultáneas' },
  { key: 'audioQuality', label: 'Calidad de audio' },
  { key: 'autoplayEnabled', label: 'Autoplay inteligente' },
  { key: 'customBranding', label: 'Branding personalizado' },
  { key: 'supportLevel', label: 'Soporte' },
  { key: 'analyticsEnabled', label: 'Analytics' }
];

interface Props {
  plans: RuntimePlan[];
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? 'Sí' : 'No';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.join(', ');
  }
  if (value === -1) {
    return 'Ilimitado';
  }
  return value?.toString() ?? '—';
}

export function PlanFeatureMatrix({ plans }: Props) {
  if (plans.length === 0) {
    return null;
  }

  return (
    <section className="space-y-6 rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-white/40">Comparativa</p>
          <h2 className="text-2xl font-semibold">Qué desbloquea cada nivel</h2>
        </div>
        <span className="text-sm text-white/60">
          Datos sincronizados en segundos cada vez que ajustás límites o beneficios.
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr>
              <th className="py-3 pr-4 text-white/70">Capacidad</th>
              {plans.map((plan) => (
                <th key={plan.tier} className="py-3 px-4 text-center text-white">
                  {plan.displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {FEATURE_KEYS.map((feature) => (
              <tr key={feature.key}>
                <td className="py-3 pr-4 text-white/70">{feature.label}</td>
                {plans.map((plan) => (
                  <td key={`${plan.tier}-${feature.key}`} className="py-3 px-4 text-center text-white">
                    {formatValue(plan.features?.[feature.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
