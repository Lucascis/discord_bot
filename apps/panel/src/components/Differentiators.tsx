const points = [
  {
    title: 'Studio Quality Audio',
    description: 'Experience music as it was meant to be heard. 320kbps audio with zero compression artifacts.'
  },
  {
    title: 'Web Dashboard',
    description: 'Control the party from your browser. Manage queues, skip tracks, and adjust volume in real-time.'
  },
  {
    title: 'Smart Autoplay',
    description: 'The music never stops. Our AI predicts what you want to hear next based on your listening history.'
  },
  {
    title: 'Synced Lyrics',
    description: 'Sing along with real-time synchronized lyrics for millions of songs. Karaoke night, sorted.'
  }
];

interface Props {
  id?: string;
}

export function Differentiators({ id }: Props) {
  return (
    <section id={id} className="space-y-8">
      <div className="text-center max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold font-display">Everything you need</h2>
        <p className="text-white/60 mt-2">Built for music lovers, by music lovers.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {points.map((point) => (
          <div key={point.title} className="glass-card rounded-2xl p-6 hover:border-brand-500/30 transition-colors">
            <h3 className="text-xl font-bold text-brand-200 mb-3">{point.title}</h3>
            <p className="text-sm text-white/70 leading-relaxed">{point.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
