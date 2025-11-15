const services = [
  { name: 'Gateway', status: 'healthy', latency: '46ms' },
  { name: 'Audio (Lavalink)', status: 'healthy', latency: '38ms' },
  { name: 'Worker', status: 'healthy', latency: '62ms' },
  { name: 'Redis Cluster', status: 'degraded', latency: '120ms' }
];

export function MonitoringPanel() {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/40 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.4em] text-white/40">Observabilidad</p>
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
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${service.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-200'}`}>
              {service.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
