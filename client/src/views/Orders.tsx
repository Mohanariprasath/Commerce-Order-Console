import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MagnifyingGlass, X, CaretRight, Tray } from '@phosphor-icons/react';
import { useConsole } from '../state';
import { api, money } from '../api';
import { StatusBadge } from '../components/ui';
import { dur, ease, spring } from '../motion';
import type { OrderSummary, Status } from '../types';

const FILTERS: ('' | Status)[] = ['', 'Placed', 'Packed', 'Shipped', 'Cancelled'];
const fmt = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Orders() {
  const { search, setSearch, statusFilter, setStatusFilter, orders: all, version, openOrder, openRef, toast } = useConsole();
  const [rows, setRows] = useState<OrderSummary[] | null>(null);

  useEffect(() => {
    let active = true;
    const delay = search ? 150 : 0;
    const t = window.setTimeout(() => {
      api.orders(search, statusFilter)
        .then((data) => { if (active) setRows(data); })
        .catch((e) => { if (active) toast({ tone: 'error', title: 'Could not load orders', body: e.message }); });
    }, delay);
    return () => { active = false; window.clearTimeout(t); };
  }, [search, statusFilter, version, toast]);

  const countOf = (s: '' | Status) => (s ? all.filter((o) => o.status === s).length : all.length);

  return (
    <div className="card table-card">
      <div className="toolbar">
        <label className="search">
          <MagnifyingGlass size={16} aria-hidden />
          <input type="search" placeholder="Search by order reference" aria-label="Search by order reference" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button type="button" className="icon-btn sm" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} aria-hidden /></button>}
        </label>
        <div className="segmented" role="radiogroup" aria-label="Filter by status">
          {FILTERS.map((s) => (
            <button key={s || 'all'} type="button" role="radio" aria-checked={statusFilter === s} className={'seg' + (statusFilter === s ? ' on' : '')} onClick={() => setStatusFilter(s)}>
              {statusFilter === s && <motion.span layoutId="seg-pill" className="seg-pill" transition={spring} />}
              <span className="seg-label">{s || 'All'}</span>
              <span className="seg-count tabular">{countOf(s)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Reference</th><th>Status</th><th className="r">Total</th><th>Created</th><th>Last update</th><th aria-label="Open" /></tr>
          </thead>
          <tbody>
            {rows === null && Array.from({ length: 5 }, (_, i) => (
              <tr key={i} className="sk-row"><td colSpan={6}><div className="skeleton" style={{ height: 18 }} /></td></tr>
            ))}
            <AnimatePresence initial={false}>
              {rows?.map((o, i) => (
                <motion.tr key={o.ref} className={'row' + (openRef === o.ref ? ' selected' : '')} onClick={() => openOrder(o.ref)}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease, delay: Math.min(i, 8) * 0.025 } }}
                  exit={{ opacity: 0, transition: { duration: dur.fast } }}>
                  <td data-label="Reference">
                    <div className="ref-cell">
                      <button type="button" className="link mono strong" onClick={(e) => { e.stopPropagation(); openOrder(o.ref); }}>{o.ref}</button>
                      {o.customerName && <span className="muted sm row-customer">{o.customerName}</span>}
                    </div>
                  </td>
                  <td data-label="Status"><StatusBadge status={o.status} /></td>
                  <td data-label="Total" className="r mono tabular">{money(o.totalCents)}</td>
                  <td data-label="Created" className="muted tabular">{fmt(o.createdAt)}</td>
                  <td data-label="Updated" className="muted tabular">{fmt(o.updatedAt)}</td>
                  <td className="r chev"><CaretRight size={16} aria-hidden /></td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
        {rows?.length === 0 && (
          <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Tray size={40} weight="duotone" aria-hidden />
            <p>{all.length ? 'No orders match these filters.' : 'No orders yet.'}</p>
            {(search || statusFilter) && <button type="button" className="btn btn-secondary sm" onClick={() => { setSearch(''); setStatusFilter(''); }}>Reset filters</button>}
          </motion.div>
        )}
      </div>
    </div>
  );
}
