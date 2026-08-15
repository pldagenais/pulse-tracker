import { MODE } from './source';
import { callRemote } from './convexClient';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Cloud mode: the same call is served from the Convex mirror. Branching
  // here keeps queries.ts and every component identical across both modes.
  if (MODE === 'cloud') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return (await callRemote(url, init?.method ?? 'GET', body)) as T;
  }
  const res = await fetch(url, init);
  let body: { ok?: boolean; data?: T; error?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok || !body?.ok) {
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  return body.data as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, data?: unknown) =>
    request<T>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  put: <T>(url: string, data: unknown) =>
    request<T>(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};

/** Build a query string, skipping null/undefined/empty values. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
