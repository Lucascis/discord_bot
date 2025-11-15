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

export async function getRuntimePlans(): Promise<RuntimePlan[]> {
  try {
    return await apiFetch<RuntimePlan[]>('/api/v1/plans/runtime');
  } catch {
    return [];
  }
}

export async function getDatabasePlans(): Promise<Array<{ tierName: string; prices: PlanPrice[]; description?: string }>> {
  try {
    return await apiFetch<Array<{ tierName: string; prices: PlanPrice[]; description?: string }>>('/api/v1/plans');
  } catch {
    return [];
  }
}
