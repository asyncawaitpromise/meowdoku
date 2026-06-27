/**
 * Centralized HTTP client.
 *
 * Automatically attaches the current user's Authorization header on every
 * request. Throws ApiError on non-2xx responses so callers can use a single
 * try/catch instead of manually checking res.ok.
 *
 * Usage:
 *   import { apiClient } from './apiClient.ts';
 *   const data = await apiClient.get('/api/widgets');
 *   const data = await apiClient.post('/api/widgets', { name: 'foo' });
 *
 * Non-React usage (e.g. in a store or service):
 *   import { useAuthStore } from '../store/authStore.ts';
 *   const token = useAuthStore.getState().token;  // no hook needed
 */

import { useAuthStore } from '../store/authStore.ts'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const token = useAuthStore.getState().token
  const headers: HeadersInit = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const res = await fetch(url, { ...options, headers })

  if (res.status === 204) return null as T

  const data = await res.json() as T & { error?: string }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status)
  return data
}

export const apiClient = {
  get: <T = unknown>(url: string) =>
    request<T>(url),

  post: <T = unknown>(url: string, body: unknown) =>
    request<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  patch: <T = unknown>(url: string, body: unknown) =>
    request<T>(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  delete: <T = unknown>(url: string) =>
    request<T>(url, { method: 'DELETE' }),

  // FormData upload — do NOT set Content-Type; the browser adds the boundary.
  postForm: <T = unknown>(url: string, formData: FormData) =>
    request<T>(url, { method: 'POST', body: formData }),
}
