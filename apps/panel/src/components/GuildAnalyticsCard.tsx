import type { GuildAnalytics } from '@/lib/analytics-client';

interface Props {
  analytics: GuildAnalytics | null;
}

export function GuildAnalyticsCard({ analytics }: Props) {
  if (!analytics) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60">
        No hay métricas disponibles todavía.
      </div>
    );
  }

  const totalHours = Math.round((analytics.metrics.totalPlaytime / 3600) * 10) / 10;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Actividad</p>
          <h3 className="text-2xl font-semibold">Última {analytics.period}</h3>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-black/30 p-4">
          <p className="text-sm text-white/60">Tracks reproducidos</p>
          <p className="text-3xl font-bold">{analytics.metrics.totalTracks}</p>
        </div>
        <div className="rounded-xl bg-black/30 p-4">
          <p className="text-sm text-white/60">Horas</p>
          <p className="text-3xl font-bold">{totalHours}</p>
        </div>
        <div className="rounded-xl bg-black/30 p-4">
          <p className="text-sm text-white/60">Usuarios únicos</p>
          <p className="text-3xl font-bold">{analytics.metrics.uniqueUsers}</p>
        </div>
      </div>
      <div className="mt-6">
        <p className="text-sm text-white/60">Top canciones</p>
        <ul className="mt-2 space-y-2 text-sm text-white/80">
          {analytics.metrics.popularTracks.slice(0, 3).map((pop) => (
            <li key={pop.track.identifier} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span>{pop.track.title}</span>
              <span className="text-white/50">{pop.playCount} plays</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
