import { apiFetch } from './api-client';

export type PlanPrice = {
  id?: string;
  provider: string;
  providerPriceId: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  active?: boolean;
};

export type RuntimePlan = {
  tier: string;
  displayName: string;
  description?: string;
  price: {
    monthly: number;
    yearly: number;
  };
  features?: Record<string, unknown>;
  limits?: Record<string, unknown>;
};

const PUBLIC_SUBSCRIPTION_TIERS = new Set(['FREE', 'BASIC', 'PREMIUM']);

export async function getRuntimePlans(): Promise<RuntimePlan[]> {
  try {
    const plans = await apiFetch<RuntimePlan[]>('/api/v1/plans/runtime');
    return Array.isArray(plans)
      ? plans.filter((plan) => PUBLIC_SUBSCRIPTION_TIERS.has(plan.tier.toUpperCase()))
      : [];
  } catch {
    return [];
  }
}

export async function getDatabasePlans(): Promise<Array<{ tierName: string; prices: PlanPrice[]; description?: string }>> {
  try {
    const dbPlans = await apiFetch<Array<{ tierName: string; prices: PlanPrice[]; description?: string }>>('/api/v1/plans');
    if (!Array.isArray(dbPlans)) return [];
    return dbPlans.filter((plan) => PUBLIC_SUBSCRIPTION_TIERS.has(plan.tierName.toUpperCase()));
  } catch {
    return [];
  }
}
