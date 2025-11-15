import { apiFetch } from './api-client';
import type { PlanPrice } from './plan-client';

export type AdminPlanRecord = {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  active: boolean;
  features?: Record<string, unknown> | null;
  prices: Array<PlanPrice & { id: string; active: boolean }>;
};

export async function getAdminPlans(): Promise<AdminPlanRecord[]> {
  try {
    return await apiFetch<AdminPlanRecord[]>('/api/v1/plans');
  } catch {
    return [];
  }
}

export async function updatePlanMetadata(planId: string, payload: { displayName?: string; description?: string; active?: boolean; experiments?: string[] }) {
  await apiFetch(`/api/v1/plans/${planId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function updatePlanPrice(planId: string, priceId: string, payload: { amount?: number; currency?: string; interval?: string; intervalCount?: number; providerPriceId?: string; active?: boolean }) {
  await apiFetch(`/api/v1/plans/${planId}/prices/${priceId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export async function createPlanPrice(planId: string, payload: { provider: string; providerPriceId: string; amount: number; currency: string; interval: string; intervalCount?: number }) {
  await apiFetch(`/api/v1/plans/${planId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function reloadPlanCache() {
  await apiFetch('/api/v1/plans/reload', {
    method: 'POST'
  });
}
