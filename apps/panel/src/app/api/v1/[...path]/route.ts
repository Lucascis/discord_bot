import { auth } from '@/app/auth';
import { NextRequest } from 'next/server';

const API_BASE_URL = (process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://api:3000').trim();
const API_KEY = (process.env.API_KEY || '').trim();

const PUBLIC_GET_PATHS = new Set<string>([
  'health',
  'plans',
  'plans/runtime',
]);

function isPublicGetPath(path: string, method: string): boolean {
  if (method !== 'GET') return false;
  if (path === '') return true;
  return PUBLIC_GET_PATHS.has(path);
}

async function proxyRequest(request: NextRequest, rawPath: string[]): Promise<Response> {
  const path = (rawPath ?? []).join('/');
  const session = await auth();
  const userId = session?.user?.id;

  if (!isPublicGetPath(path, request.method) && !userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }

  const upstreamUrl = new URL(`/api/v1/${path}`, API_BASE_URL);
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  headers.delete('x-api-key');

  if (API_KEY) {
    headers.set('x-api-key', API_KEY);
  }
  if (userId) {
    headers.set('x-discord-user-id', userId);
  }

  const method = request.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);
  const body = hasBody ? await request.text() : undefined;

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method,
    headers,
    body,
    cache: 'no-store',
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('transfer-encoding');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders
  });
}

type RouteContext = {
  params?: { path?: string[] } | Promise<{ path?: string[] }>;
};

async function extractPath(context: RouteContext): Promise<string[]> {
  const resolved = context.params ? await context.params : undefined;
  return resolved?.path ?? [];
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return await proxyRequest(request, await extractPath(context));
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return await proxyRequest(request, await extractPath(context));
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  return await proxyRequest(request, await extractPath(context));
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return await proxyRequest(request, await extractPath(context));
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  return await proxyRequest(request, await extractPath(context));
}
