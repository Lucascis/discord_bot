const highlights = [
  {
    title: 'Inicio de sesión verificado',
    description: 'Autenticamos con Discord OAuth 2.0 para garantizar que cada acción provenga de un miembro real de tu comunidad.'
  },
  {
    title: 'Control de acceso por rol',
    description: 'Definí quién puede administrar planes o monitorear servidores respetando los permisos de tu comunidad.'
  },
  {
    title: 'Datos protegidos',
    description: 'El panel muestra métricas agregadas y catálogos aprobados. Claves, secretos y automatizaciones quedan cifrados en la API privada.'
  },
  {
    title: 'Trazabilidad total',
    description: 'Cada cambio queda registrado con hora, usuario y servidor para que puedas auditar campañas o resolver tickets premium.'
  }
];

export function TrustHighlights() {
  return (
    <section id="security" className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-[0.4em] text-white/40">Confianza empresarial</p>
        <h2 className="text-3xl font-semibold">Transparencia para tus clientes premium</h2>
        <p className="text-white/70">
          Resumimos el programa de seguridad y cumplimiento que tus propios clientes necesitan ver: garantías claras y comunicación directa.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {highlights.map((item) => (
          <article key={item.title} className="rounded-xl border border-white/10 bg-black/30 p-4">
            <h3 className="text-xl font-semibold">{item.title}</h3>
            <p className="mt-2 text-sm text-white/70">{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
