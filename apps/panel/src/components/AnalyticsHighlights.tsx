import type { DashboardMetrics } from '@/lib/analytics-client';

interface Props {
  metrics: DashboardMetrics | null;
  id?: string;
}

const skeleton = [
  { label: 'Guilds totales', value: '—' },
  { label: 'Usuarios totales', value: '—' },
  { label: 'Tracks hoy', value: '—' },
  { label: 'Comandos hoy', value: '—' }
];

function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number') return '—';
  return value.toLocaleString('es-AR');
}

export function AnalyticsHighlights({ metrics, id }: Props) {
  const cards = metrics
    ? [
        { label: 'Guilds totales', value: formatNumber(metrics.overview.totalGuilds) },
        { label: 'Usuarios totales', value: formatNumber(metrics.overview.totalUsers) },
        { label: 'Tracks hoy', value: formatNumber(metrics.activity.tracksToday) },
        { label: 'Comandos hoy', value: formatNumber(metrics.activity.commandsToday) }
      ]
    : skeleton;

  return (
    <section id={id} className="rounded-2xl border border-white/10 bg-black/40 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-white/40">Telemetría</p>
          <h2 className="mt-2 text-2xl font-semibold">Estado de la red de guilds</h2>
        </div>
        {metrics && (
          <span className="text-xs text-white/60">
            Uptime: {(metrics.performance.uptime / 3600).toFixed(1)} hs · Error rate: {metrics.performance.errorRate.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">{card.label}</p>
            <p className="text-2xl font-semibold text-white">{card.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
