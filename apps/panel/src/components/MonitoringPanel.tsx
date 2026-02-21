import type { PlatformHealth } from '@/lib/health-client';

interface Props {
  health: PlatformHealth | null;
}

function normalizeStatus(value?: string): 'online' | 'degraded' | 'offline' {
  if (value === 'healthy') return 'online';
  if (value === 'degraded') return 'degraded';
  if (value === 'unhealthy') return 'offline';
  return 'degraded';
}

export function MonitoringPanel({ health }: Props) {
  const services = health
    ? [
        {
          name: 'API pública',
          status: normalizeStatus(health.status),
          latency: `${(health.metrics as { responseTime?: number } | undefined)?.responseTime ?? 0}ms`
        },
        {
          name: 'Base de datos',
          status: normalizeStatus(health.checks?.database?.status),
          latency: `${health.checks?.database?.responseTime ?? 0}ms`
        },
        {
          name: 'Redis',
          status: normalizeStatus(health.checks?.redis?.status),
          latency: `${health.checks?.redis?.responseTime ?? 0}ms`
        },
        {
          name: 'Audio/Lavalink',
          status: normalizeStatus(health.checks?.lavalink?.status),
          latency: `${health.checks?.lavalink?.responseTime ?? 0}ms`
        }
      ]
    : [
        { name: 'Streaming core', status: 'degraded', latency: '—' },
        { name: 'Panel Studio', status: 'degraded', latency: '—' },
        { name: 'Automations', status: 'degraded', latency: '—' },
        { name: 'Billing API', status: 'degraded', latency: '—' }
      ];

  return (
    <section className="rounded-2xl border border-white/10 bg-black/40 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.4em] text-white/40">Disponibilidad</p>
          <h2 className="mt-2 text-2xl font-semibold">Status en vivo</h2>
        </div>
        <a href="/status" className="text-sm text-brand-200 hover:text-brand-100">Ver status completo →</a>
      </div>
      <div className="mt-6 space-y-3 text-sm">
        {services.map((service) => (
          <div key={service.name} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
            <div>
              <p className="font-medium">{service.name}</p>
              <p className="text-xs text-white/50">Latencia {service.latency}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${service.status === 'online'
              ? 'bg-emerald-500/20 text-emerald-300'
              : service.status === 'offline'
                ? 'bg-rose-500/20 text-rose-200'
                : 'bg-amber-500/20 text-amber-200'
            }`}>
              {service.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
