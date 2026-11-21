import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { OrderSummary, Product, Status } from './types';

export type View = 'overview' | 'new' | 'orders';
export interface Toast { id: number; tone: 'success' | 'error'; title: string; body?: string }

interface ConsoleState {
  products: Product[];
  orders: OrderSummary[];
  loaded: boolean;
  online: boolean;
  refreshing: boolean;
  lastSyncedAt: Date | null;
  version: number;
  refresh: () => Promise<void>;
  cart: Record<number, number>;
  setCart: (c: Record<number, number>) => void;
  customerName: string;
  setCustomerName: (s: string) => void;
  notes: string;
  setNotes: (s: string) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  view: View;
  go: (v: View) => void;
  search: string;
  setSearch: (s: string) => void;
  statusFilter: '' | Status;
  setStatusFilter: (s: '' | Status) => void;
  openRef: string | null;
  openOrder: (ref: string | null) => void;
}

const Ctx = createContext<ConsoleState | null>(null);
export const useConsole = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('ConsoleProvider missing');
  return c;
};

const viewFromHash = (): View => {
  const h = location.hash.replace('#/', '');
  return h === 'new' || h === 'orders' ? h : 'overview';
};

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [version, setVersion] = useState(0);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [view, setView] = useState<View>(viewFromHash);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [openRef, openOrder] = useState<string | null>(null);

  const inflightRef = useRef<Promise<void> | null>(null);
  const lastSyncMsRef = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    const job = (async () => {
      setRefreshing(true);
      try {
        const [p, o] = await Promise.all([api.products(), api.orders()]);
        setProducts(p);
        setOrders(o);
        setOnline(true);
        const now = new Date();
        setLastSyncedAt(now);
        lastSyncMsRef.current = now.getTime();
        // Keep the cart consistent with live stock.
        setCart((c) => {
          const next: Record<number, number> = {};
          for (const [id, q] of Object.entries(c)) {
            const prod = p.find((x) => x.id === Number(id));
            if (prod && prod.stock > 0) next[prod.id] = Math.min(q, prod.stock);
          }
          return next;
        });
        setVersion((v) => v + 1);
      } catch {
        setOnline(false);
      } finally {
        setLoaded(true);
        setRefreshing(false);
        inflightRef.current = null;
      }
    })();
    inflightRef.current = job;
    return job;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Multi-staff live sync: refresh whenever tab regains focus or becomes visible.
  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastSyncMsRef.current < 1500) return;
      refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onResume();
    };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((v: View) => {
    location.hash = v === 'overview' ? '/' : '/' + v;
    setView(v);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  const value = useMemo<ConsoleState>(() => ({
    products, orders, loaded, online, refreshing, lastSyncedAt, version, refresh,
    cart, setCart, customerName, setCustomerName, notes, setNotes,
    toasts, toast, dismiss,
    view, go, search, setSearch, statusFilter, setStatusFilter, openRef, openOrder,
  }), [
    products, orders, loaded, online, refreshing, lastSyncedAt, version, refresh,
    cart, customerName, notes, toasts, toast, dismiss, view, go, search, statusFilter, openRef,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
