import { Hero } from '@/components/Hero';
import { PlanGrid } from '@/components/PlanGrid';
import { Differentiators } from '@/components/Differentiators';
import { PlanFeatureMatrix } from '@/components/PlanFeatureMatrix';
import { getRuntimePlans } from '@/lib/plan-client';

export default async function Page() {
  const plans = await getRuntimePlans();
  const safePlans = Array.isArray(plans) ? plans : [];

  return (
    <main className="flex min-h-screen flex-col gap-14 py-6">
      <Hero />

      <Differentiators id="features" />

      <section id="plans" className="space-y-6">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold font-display">Planes para lanzar sin fricción</h2>
          <p className="text-white/70 text-lg">
            Empezá en Free para validar. Escalá a pagos para control web, invocación desde panel y operación multi-servidor.
          </p>
        </div>
        <PlanGrid plans={safePlans} />
      </section>

      <PlanFeatureMatrix plans={safePlans} />
    </main>
  );
}
