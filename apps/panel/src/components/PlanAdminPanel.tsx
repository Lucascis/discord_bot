'use client';

import { useMemo, useState, useTransition } from 'react';
import type { AdminPlanRecord } from '@/lib/admin-plan-client';
import { updatePlanMetadata, updatePlanPrice, createPlanPrice, reloadPlanCache } from '@/lib/admin-plan-client';
import { formatter } from '@/lib/utils';

interface Props {
  initialPlans: AdminPlanRecord[];
}

type PlanState = AdminPlanRecord & {
  experimentsText: string;
};

function toStateRecord(record: AdminPlanRecord): PlanState {
  const experiments = Array.isArray(record.features?.experiments)
    ? (record.features?.experiments as string[])
    : [];
  return {
    ...record,
    experimentsText: experiments.join(', ')
  };
}

export function PlanAdminPanel({ initialPlans }: Props) {
  const [plans, setPlans] = useState<PlanState[]>(initialPlans.map(toStateRecord));
  const [message, setMessage] = useState('');
  const [isReloadPending, startReload] = useTransition();

  const handlePlanUpdate = async (planId: string, payload: { displayName?: string; description?: string; active?: boolean; experiments?: string[] }) => {
    await updatePlanMetadata(planId, payload);
    setPlans((prev) => prev.map((plan) => {
      if (plan.id !== planId) return plan;
      const nextFeatures = payload.experiments ? { ...(plan.features ?? {}), experiments: payload.experiments } : plan.features;
      return {
        ...plan,
        displayName: payload.displayName ?? plan.displayName,
        description: payload.description ?? plan.description,
        active: typeof payload.active === 'boolean' ? payload.active : plan.active,
        features: nextFeatures,
        experimentsText: payload.experiments ? payload.experiments.join(', ') : plan.experimentsText
      };
    }));
  };

  const handlePriceUpdate = async (planId: string, priceId: string, payload: { amount?: number; currency?: string; interval?: string; intervalCount?: number; providerPriceId?: string; active?: boolean }) => {
    await updatePlanPrice(planId, priceId, payload);
    setPlans((prev) => prev.map((plan) => {
      if (plan.id !== planId) return plan;
      return {
        ...plan,
        prices: plan.prices.map((price) => price.id === priceId ? { ...price, ...payload } : price)
      };
    }));
  };

  const handlePriceCreate = async (planId: string, payload: { provider: string; providerPriceId: string; amount: number; currency: string; interval: string; intervalCount?: number }) => {
    await createPlanPrice(planId, payload);
    setMessage('Se creó un nuevo precio. Recargá el cache para verlo reflejado en runtime.');
  };

  const handleReload = () => {
    startReload(async () => {
      await reloadPlanCache();
      setMessage('Runtime actualizado con los últimos cambios.');
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Plan Engine</p>
          <p className="text-white/70">Editá planes y precios directamente sobre la base.</p>
        </div>
        <button
          onClick={handleReload}
          disabled={isReloadPending}
          className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          {isReloadPending ? 'Recargando...' : 'Recargar runtime'}
        </button>
      </div>
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      <div className="grid gap-6">
        {plans.map((plan) => (
          <PlanAdminCard
            key={plan.id}
            plan={plan}
            onPlanSave={handlePlanUpdate}
            onPriceSave={handlePriceUpdate}
            onPriceCreate={handlePriceCreate}
          />
        ))}
        {plans.length === 0 && (
          <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/60">No se encontraron planes en la base.</p>
        )}
      </div>
    </div>
  );
}

interface CardProps {
  plan: PlanState;
  onPlanSave: (planId: string, payload: { displayName?: string; description?: string; active?: boolean; experiments?: string[] }) => Promise<void>;
  onPriceSave: (planId: string, priceId: string, payload: { amount?: number; currency?: string; interval?: string; intervalCount?: number; providerPriceId?: string; active?: boolean }) => Promise<void>;
  onPriceCreate: (planId: string, payload: { provider: string; providerPriceId: string; amount: number; currency: string; interval: string; intervalCount?: number }) => Promise<void>;
}

function PlanAdminCard({ plan, onPlanSave, onPriceSave, onPriceCreate }: CardProps) {
  const [state, setState] = useState(plan);
  const [saving, startSaving] = useTransition();
  const [priceCreation, setPriceCreation] = useState({ provider: 'stripe', providerPriceId: '', amount: 0, currency: 'USD', interval: 'MONTH' });

  const experimentsArray = useMemo(() => state.experimentsText.split(',').map((exp) => exp.trim()).filter(Boolean), [state.experimentsText]);

  const handleSubmit = () => {
    startSaving(async () => {
      await onPlanSave(plan.id, {
        displayName: state.displayName ?? undefined,
        description: state.description ?? undefined,
        active: state.active,
        experiments: experimentsArray
      });
    });
  };

  const handlePriceSubmit = (priceId: string) => {
    const priceDraft = state.prices.find((price) => price.id === priceId);
    if (!priceDraft) return;
    startSaving(async () => {
      await onPriceSave(plan.id, priceId, {
        amount: priceDraft.amount,
        currency: priceDraft.currency,
        interval: priceDraft.interval,
        intervalCount: priceDraft.intervalCount,
        providerPriceId: priceDraft.providerPriceId,
        active: priceDraft.active
      });
    });
  };

  const handlePriceCreateLocal = () => {
    startSaving(async () => {
      await onPriceCreate(plan.id, priceCreation);
      setPriceCreation({ provider: 'stripe', providerPriceId: '', amount: 0, currency: 'USD', interval: 'MONTH' });
    });
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-semibold">{plan.displayName ?? plan.name}</h3>
          <p className="text-sm text-white/60">ID: {plan.id}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={state.active}
            onChange={(e) => setState((prev) => ({ ...prev, active: e.target.checked }))}
            disabled={saving}
          />
          Activo
        </label>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span>Título</span>
          <input
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2"
            value={state.displayName ?? ''}
            onChange={(e) => setState((prev) => ({ ...prev, displayName: e.target.value }))}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Experimentos (coma)</span>
          <input
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2"
            value={state.experimentsText}
            onChange={(e) => setState((prev) => ({ ...prev, experimentsText: e.target.value }))}
            disabled={saving}
          />
        </label>
      </div>
      <label className="mt-4 flex flex-col gap-1 text-sm">
        <span>Descripción</span>
        <textarea
          className="rounded-xl border border-white/10 bg-black/30 px-3 py-2"
          value={state.description ?? ''}
          onChange={(e) => setState((prev) => ({ ...prev, description: e.target.value }))}
          disabled={saving}
        />
      </label>
      <button
        onClick={handleSubmit}
        disabled={saving}
        className="mt-4 rounded-xl bg-brand-500/80 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
      >
        {saving ? 'Guardando...' : 'Guardar plan'}
      </button>

      <div className="mt-6 space-y-3">
        <h4 className="text-xl font-semibold">Precios</h4>
        {plan.prices.map((price) => (
          <div key={price.id} className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-white/70">{price.provider.toUpperCase()}</span>
              <span className="text-white/50">{price.providerPriceId}</span>
              <span className="ml-auto text-white/50">{formatter(price.amount)}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span>Monto (centavos)</span>
                <input
                  type="number"
                  value={price.amount}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      prices: prev.prices.map((p) => p.id === price.id ? { ...p, amount: Number(e.target.value) } : p)
                    }))
                  }
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  disabled={saving}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span>Currency</span>
                <input
                  value={price.currency}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      prices: prev.prices.map((p) => p.id === price.id ? { ...p, currency: e.target.value.toUpperCase() } : p)
                    }))
                  }
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  disabled={saving}
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={price.active ?? true}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      prices: prev.prices.map((p) => p.id === price.id ? { ...p, active: e.target.checked } : p)
                    }))
                  }
                  disabled={saving}
                />
                Activo
              </label>
              <button
                type="button"
                onClick={() => handlePriceSubmit(price.id!)}
                disabled={saving}
                className="ml-auto rounded-lg border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
              >
                Guardar precio
              </button>
            </div>
          </div>
        ))}

        <div className="rounded-xl border border-dashed border-white/20 p-4 text-sm">
          <p className="text-white/60">Agregar nuevo precio</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              placeholder="Proveedor"
              value={priceCreation.provider}
              onChange={(e) => setPriceCreation((prev) => ({ ...prev, provider: e.target.value }))}
              disabled={saving}
            />
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              placeholder="Price ID"
              value={priceCreation.providerPriceId}
              onChange={(e) => setPriceCreation((prev) => ({ ...prev, providerPriceId: e.target.value }))}
              disabled={saving}
            />
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              placeholder="Monto"
              type="number"
              value={priceCreation.amount}
              onChange={(e) => setPriceCreation((prev) => ({ ...prev, amount: Number(e.target.value) }))}
              disabled={saving}
            />
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              placeholder="Currency"
              value={priceCreation.currency}
              onChange={(e) => setPriceCreation((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))}
              disabled={saving}
            />
            <select
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              value={priceCreation.interval}
              onChange={(e) => setPriceCreation((prev) => ({ ...prev, interval: e.target.value }))}
              disabled={saving}
            >
              <option value="MONTH">Mensual</option>
              <option value="YEAR">Anual</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handlePriceCreateLocal}
            disabled={saving || !priceCreation.providerPriceId}
            className="mt-3 rounded-xl border border-white/20 px-4 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            Crear precio
          </button>
        </div>
      </div>
    </article>
  );
}
