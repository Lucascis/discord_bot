export function EnterpriseCTA() {
  return (
    <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500/30 via-purple-700/20 to-black p-8 text-white shadow-neon">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.5em] text-white/60">Soluciones a medida</p>
          <h2 className="text-3xl font-bold">¿Listo para administrar miles de guilds?</h2>
          <p className="text-white/80">
            Para clientes que ya superan cómodamente el plan Pro ofrecemos proyectos custom: te asignamos un TAM dedicado, un canal
            privado en Discord y playbooks de lanzamiento. Además, integramos tu stack de billing y monitoreo para que todo quede auditado.
          </p>
          <ul className="space-y-2 text-sm text-white/80">
            <li>• Onboarding técnico en 48hs</li>
            <li>• Runbooks para incidentes y rotación de tokens</li>
            <li>• Integraciones personalizadas (Datadog, PagerDuty, Snowflake)</li>
          </ul>
        </div>
        <div className="space-y-4 rounded-2xl border border-white/20 bg-black/40 p-6">
          <h3 className="text-xl font-semibold">Agenda una demo privada</h3>
          <p className="text-white/70">Nuestro equipo muestra dashboards, automatizaciones y cómo operamos updates sin downtime.</p>
          <form className="space-y-3">
            <input
              className="w-full rounded-xl border border-white/20 bg-black/40 px-4 py-3 text-white placeholder:text-white/40 focus:border-brand-400 focus:outline-none"
              placeholder="Email corporativo"
              type="email"
              required
            />
            <input
              className="w-full rounded-xl border border-white/20 bg-black/40 px-4 py-3 text-white placeholder:text-white/40 focus:border-brand-400 focus:outline-none"
              placeholder="Cantidad estimada de guilds"
              type="number"
              min={10}
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-white/90 px-4 py-3 text-base font-semibold text-black transition hover:bg-white"
            >
              Reservar slot
            </button>
          </form>
          <p className="text-xs text-white/60">
            Procesamos la solicitud y coordinamos por Discord. Toda la info queda cifrada y auditada.
          </p>
        </div>
      </div>
    </section>
  );
}
