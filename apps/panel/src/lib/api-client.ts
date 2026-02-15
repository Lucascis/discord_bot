const isServer = typeof window === 'undefined';

function getInternalApiBase(): string {
  return process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://api:3000';
}

function getServerApiKey(): string {
  return process.env.API_KEY || '';
}

function resolveBaseUrl(): string {
  // Browser requests go through Next.js BFF (/api/v1/*), never directly to backend API.
  return isServer ? getInternalApiBase() : '';
}

export interface ApiRequestOptions extends globalThis.RequestInit {
  rawResponse?: boolean;
  apiKey?: string;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const baseUrl = resolveBaseUrl();
  const targetUrl = path.startsWith('http') ? path : `${baseUrl}${path}`;
  const { rawResponse, headers, apiKey, ...rest } = options;
  const resolvedApiKey = isServer ? (apiKey ?? getServerApiKey()) : undefined;

  const res = await fetch(targetUrl, {
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(resolvedApiKey ? { 'X-API-Key': resolvedApiKey } : {}),
      ...(headers || {})
    },
    ...rest
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API request failed: ${res.status} ${body}`);
  }

  const payload = await res.json();
  return (rawResponse ? payload : (payload.data ?? payload)) as T;
}
