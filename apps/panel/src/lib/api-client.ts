const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.NEXT_PUBLIC_PANEL_API_KEY || '';

type ApiRequestOptions = Parameters<typeof fetch>[1];

export async function apiFetch<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API request failed: ${res.status} ${body}`);
  }

  const payload = await res.json();
  return (payload.data ?? payload) as T;
}
