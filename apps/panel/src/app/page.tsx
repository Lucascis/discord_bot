import { Hero } from '@/components/Hero';
import { Differentiators } from '@/components/Differentiators';
import { getAnalyticsOverview } from '@/lib/analytics-client';
import { getPlatformHealth } from '@/lib/health-client';
import { AnalyticsHighlights } from '@/components/AnalyticsHighlights';
import { MonitoringPanel } from '@/components/MonitoringPanel';
import { OperationsStatus } from '@/components/OperationsStatus';
import { TrustHighlights } from '@/components/TrustHighlights';
import { RoadmapTimeline } from '@/components/RoadmapTimeline';

export default async function Page() {
  const [metrics, health] = await Promise.all([
    getAnalyticsOverview(),
    getPlatformHealth()
  ]);

  return (
    <main className="flex min-h-screen flex-col gap-14 py-6">
      <Hero />

      <Differentiators id="features" />

      <section id="capabilities" className="space-y-6">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold font-display">Proyecto personal sin comercializacion</h2>
          <p className="text-white/70 text-lg">
            Todas las capacidades avanzadas estan disponibles para uso privado. El foco actual es estabilidad operativa y experiencia de control.
          </p>
        </div>
      </section>

      <AnalyticsHighlights metrics={metrics} id="analytics" />
      <MonitoringPanel health={health} />
      <OperationsStatus health={health} id="operations" />
      <TrustHighlights />
      <RoadmapTimeline />
    </main>
  );
}
