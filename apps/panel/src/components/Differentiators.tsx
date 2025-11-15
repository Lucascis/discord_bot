const points = [
  {
    title: 'Plan Engine 100% DB',
    description: 'Programá campañas relámpago, precios regionales y pruebas A/B sin redeploy.'
  },
  {
    title: 'Studio Mode',
    description: 'Editor visual para que cada guild premium personalice su UI dentro de Discord.'
  },
  {
    title: 'Pagos híbridos',
    description: 'Stripe + MercadoPago listos para LATAM. Detectamos país y elegimos gateway.'
  },
  {
    title: 'Insights accionables',
    description: 'Alertas proactivas cuando una comunidad se acerca a su límite o pierde engagement.'
  }
];

export function Differentiators() {
  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-semibold">¿Por qué somos diferentes?</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {points.map((point) => (
          <div key={point.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-xl font-semibold text-brand-200">{point.title}</h3>
            <p className="mt-2 text-white/70">{point.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
