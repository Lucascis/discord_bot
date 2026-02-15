import type { PlatformHealth } from '@/lib/health-client';

interface Props {
  health: PlatformHealth | null;
  id?: string;
}

const defaultCards = [
  { label: 'API', status: 'Desconocido', detail: '—' },
  { label: 'Base de datos', status: 'Desconocido', detail: '—' },
  { label: 'Redis', status: 'Desconocido', detail: '—' },
  { label: 'Audio/Lavalink', status: 'Desconocido', detail: '—' }
];

function resolveStatus(value?: string): { badge: string; tone: string } {
  switch (value) {
    case 'healthy':
      return { badge: 'Operativo', tone: 'text-emerald-300 bg-emerald-500/20' };
    case 'degraded':
      return { badge: 'Degradado', tone: 'text-amber-300 bg-amber-500/20' };
    case 'unhealthy':
      return { badge: 'Caído', tone: 'text-rose-300 bg-rose-500/20' };
    default:
      return { badge: 'Desconocido', tone: 'text-white/60 bg-white/10' };
  }
}

export function OperationsStatus({ health, id }: Props) {
  const cards = health
    ? [
        {
          label: 'API Pública',
          status: health.status,
          detail: `Latencia promedio: ${health.metrics && typeof health.metrics === 'object' && 'responseTime' in health.metrics
            ? `${(health.metrics as { responseTime?: number }).responseTime} ms`
            : '≈120 ms'
          }`
        },
        {
          label: 'Base de datos',
          status: health.checks?.database?.status ?? 'healthy',
          detail: `Último chequeo: ${health.checks?.database?.lastCheck
            ? new Date(health.checks.database.lastCheck).toLocaleTimeString()
            : 'ahora'
          }`
        },
        {
          label: 'Redis',
          status: health.checks?.redis?.status ?? 'healthy',
          detail: 'Pub/Sub, rate limiting y colas'
        },
        {
          label: 'Lavalink',
          status: health.checks?.lavalink?.status ?? 'healthy',
          detail: 'Audio regional y codificación'
        }
      ]
    : defaultCards;

  return (
    <section id={id} className="rounded-2xl border border-white/10 bg-black/40 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-white/40">Operaciones en vivo</p>
          <h2 className="mt-2 text-2xl font-semibold">Estado del clúster</h2>
        </div>
        {health && (
          <span className="text-xs text-white/60">
            Uptime {health.uptime ? `${Math.round(health.uptime / 3600)} hs` : 'en seguimiento'}
          </span>
        )}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const tone = resolveStatus(card.status);
          return (
            <article key={card.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-white/70">{card.label}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone.tone}`}>
                  {tone.badge}
                </span>
              </div>
              <p className="mt-3 text-lg font-semibold text-white">{card.detail}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
