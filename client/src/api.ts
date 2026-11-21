import type { CreateOrderPayload, OrderDetail, OrderSummary, Product, Status, StockProblem } from './types';

export const TAX_RATE = 0.08;

export function computeTotals(subtotalCents: number) {
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export class ApiError extends Error {
  constructor(message: string, public code?: string, public details?: StockProblem[]) {
    super(message);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new ApiError(data.error?.message ?? 'Request failed', data.error?.code, data.error?.details);
  return data as T;
}

export const api = {
  products: () => call<Product[]>('GET', '/api/products'),
  orders: (search = '', status = '') =>
    call<OrderSummary[]>('GET', '/api/orders?' + new URLSearchParams({ search, status })),
  order: (ref: string) => call<OrderDetail>('GET', `/api/orders/${encodeURIComponent(ref)}`),
  place: (payload: CreateOrderPayload) => call<OrderDetail>('POST', '/api/orders', payload),
  setStatus: (ref: string, status: Status) => call<OrderDetail>('POST', `/api/orders/${encodeURIComponent(ref)}/status`, { status }),
};

export const money = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
