const phases = [
  {
    title: 'Fase 0 · Setup',
    description: 'Crear app Next.js, integrar OAuth y CI.',
    eta: 'Semana 1'
  },
  {
    title: 'Fase 1 · Landing',
    description: 'Hero interactivo, comparativa y tabla de planes conectada a la API.',
    eta: 'Semana 2'
  },
  {
    title: 'Fase 2 · Portal premium',
    description: 'Dashboard de guild + Studio Mode + billing portal.',
    eta: 'Semanas 3-5'
  },
  {
    title: 'Fase 3 · Panel interno',
    description: 'Plan Engine, experiments y tablero de incidentes.',
    eta: 'Semanas 6-8'
  }
];

export function RoadmapTimeline() {
  return (
    <section id="roadmap" className="space-y-4">
      <h2 className="text-3xl font-semibold">Roadmap de implementación</h2>
      <ol className="space-y-4">
        {phases.map((phase, index) => (
          <li key={phase.title} className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm text-white/50">{String(index + 1).padStart(2, '0')}</div>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">{phase.title}</h3>
                <span className="text-xs text-white/50">{phase.eta}</span>
              </div>
              <p className="text-white/70">{phase.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
