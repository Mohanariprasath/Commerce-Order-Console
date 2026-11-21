import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  SquaresFour, PlusCircle, Receipt, Sun, Moon, MagnifyingGlass, Plus, CheckCircle, WarningCircle, X, ArrowsClockwise,
} from '@phosphor-icons/react';
import { useConsole, type View } from '../state';
import { Logo } from './ui';
import { dur, ease, easeIn, spring } from '../motion';

const NAV: { id: View; label: string; icon: typeof SquaresFour }[] = [
  { id: 'overview', label: 'Overview', icon: SquaresFour },
  { id: 'new', label: 'New order', icon: PlusCircle },
  { id: 'orders', label: 'Orders', icon: Receipt },
];

export const TITLES: Record<View, [string, string]> = {
  overview: ['Overview', 'Today at the order desk'],
  new: ['New order', 'Build an order from live stock'],
  orders: ['Orders', 'Find, inspect and fulfil orders'],
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme as 'light' | 'dark') || 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('oc-theme', theme);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0B1120' : '#F8FAFC');
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const;
}

export function Sidebar() {
  const { view, go, cart, orders, online } = useConsole();
  const [theme, toggle] = useTheme();
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const open = orders.filter((o) => o.status === 'Placed' || o.status === 'Packed').length;
  const badges: Partial<Record<View, number>> = { new: cartCount, orders: open };

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <div className="brand-text"><b>Order Console</b><small>Store operations</small></div>
      </div>
      <nav aria-label="Primary">
        {NAV.map(({ id, label, icon: I }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              className={'nav-item' + (active ? ' active' : '')}
              aria-current={active ? 'page' : undefined}
              title={id === 'new' ? 'New order (N)' : label}
              onClick={() => go(id)}
            >
              {active && <motion.span layoutId="nav-active" className="nav-active" transition={spring} />}
              <I size={20} weight={active ? 'fill' : 'regular'} aria-hidden />
              <span className="nav-label">{label}</span>
              <AnimatePresence>
                {!!badges[id] && (
                  <motion.span key={badges[id]} className="nav-badge" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring}>
                    {badges[id]}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <div className={'conn' + (online ? '' : ' off')} role="status">
          <i aria-hidden />{online ? 'Connected' : 'Server offline'}
        </div>
        <button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: dur.fast }} style={{ display: 'flex' }}>
              {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </aside>
  );
}

export function Topbar() {
  const { view, go, setSearch, setStatusFilter, refresh, refreshing, lastSyncedAt, openRef } = useConsole();
  const [q, setQ] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [manualSpin, setManualSpin] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const spinTimerRef = useRef<number | null>(null);
  const [title, sub] = TITLES[view];

  useEffect(() => () => {
    if (spinTimerRef.current) window.clearTimeout(spinTimerRef.current);
  }, []);

  // Keyboard power-user shortcuts: '/' focuses global search, 'n' opens New order.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (openRef !== null || document.querySelector('[aria-modal="true"]')) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        go('new');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, openRef]);

  const handleManualRefresh = () => {
    setManualSpin(true);
    if (spinTimerRef.current) window.clearTimeout(spinTimerRef.current);
    refresh().finally(() => {
      spinTimerRef.current = window.setTimeout(() => setManualSpin(false), 420);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatusFilter('');
    setSearch(q.trim());
    go('orders');
    searchInputRef.current?.blur();
  };

  const isSpinning = refreshing || manualSpin;
  const syncTitle = lastSyncedAt
    ? `Refresh live stock & orders (synced ${lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`
    : 'Refresh live stock & orders';

  return (
    <header className="topbar">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} className="page-title" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease } }} exit={{ opacity: 0, y: -6, transition: { duration: dur.fast, ease: easeIn } }}>
          <h1>{title}</h1>
          <p>{sub}</p>
        </motion.div>
      </AnimatePresence>
      <form className="global-search" role="search" onSubmit={submit}>
        <MagnifyingGlass size={16} aria-hidden />
        <input
          ref={searchInputRef}
          aria-label="Jump to order reference"
          aria-keyshortcuts="/"
          title="Jump to order reference (Press /)"
          placeholder="Jump to order…  ORD-000001"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') searchInputRef.current?.blur(); }}
        />
        <kbd aria-hidden="true">{searchFocused || q ? '↵' : '/'}</kbd>
      </form>
      <div className="topbar-actions">
        <button
          type="button"
          className={'icon-btn refresh-btn' + (isSpinning ? ' spinning' : '')}
          onClick={handleManualRefresh}
          disabled={refreshing}
          aria-label="Refresh stock and orders"
          aria-busy={refreshing}
          title={syncTitle}
        >
          <ArrowsClockwise size={18} aria-hidden />
        </button>
        {view !== 'new' && (
          <button
            type="button"
            className="btn btn-primary hide-sm"
            onClick={() => go('new')}
            title="Create new order (Press N)"
            aria-keyshortcuts="n"
          >
            <Plus size={16} weight="bold" aria-hidden />
            <span>New order</span>
            <kbd className="btn-kbd" aria-hidden="true">N</kbd>
          </button>
        )}
      </div>
    </header>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useConsole();
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout className={`toast toast-${t.tone}`}
            initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: dur.base, ease } }}
            exit={{ opacity: 0, x: 24, transition: { duration: dur.fast, ease: easeIn } }}>
            {t.tone === 'success' ? <CheckCircle size={20} weight="fill" aria-hidden /> : <WarningCircle size={20} weight="fill" aria-hidden />}
            <div className="toast-body"><b>{t.title}</b>{t.body && <span>{t.body}</span>}</div>
            <button type="button" className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss notification"><X size={14} aria-hidden /></button>
            <motion.i className="toast-timer" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 4.5, ease: 'linear' }} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Traps focus inside a container while mounted and restores it afterwards. */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    setTimeout(() => first?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEscape(); }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    node?.addEventListener('keydown', onKey);
    return () => { node?.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
