import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Check, Copy, ClipboardText, Package, Truck, XCircle, Warning, LockSimple, User, Note,
} from '@phosphor-icons/react';
import { useConsole } from '../state';
import { api, money } from '../api';
import { ProductIcon, StatusBadge } from './ui';
import { useFocusTrap } from './Shell';
import { dur, ease, easeIn } from '../motion';
import type { OrderDetail, Status } from '../types';

const STEPS: { status: Status; icon: typeof ClipboardText }[] = [
  { status: 'Placed', icon: ClipboardText },
  { status: 'Packed', icon: Package },
  { status: 'Shipped', icon: Truck },
];

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function Timeline({ status }: { status: Status }) {
  if (status === 'Cancelled') {
    return (
      <div className="alert alert-muted"><XCircle size={20} weight="fill" aria-hidden />
        <div><b>Order cancelled</b><span>Stock for every item was returned to inventory.</span></div>
      </div>
    );
  }
  const idx = STEPS.findIndex((s) => s.status === status);
  const completedAll = status === 'Shipped';
  return (
    <ol className="timeline" aria-label={`Fulfilment progress: ${status}`}>
      <div className="tl-track" aria-hidden>
        <motion.div
          className={'tl-fill' + (completedAll ? ' complete' : '')}
          initial={false}
          animate={{ scaleX: idx / (STEPS.length - 1) }}
          transition={{ duration: dur.slow * 1.6, ease }}
        />
      </div>
      {STEPS.map(({ status: s, icon: StepIcon }, i) => {
        const done = i <= idx;
        const isCurrent = i === idx;
        const showCheck = i < idx || (completedAll && isCurrent);
        const sub = showCheck ? 'Done' : isCurrent ? 'Current' : 'Next';
        return (
          <li
            key={s}
            className={'tl-step' + (done ? ' done' : '') + (isCurrent ? ' current' : '') + (completedAll && isCurrent ? ' complete' : '')}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <motion.span className="tl-dot" initial={false} animate={{ scale: isCurrent ? 1 : 0.92 }} transition={{ duration: dur.base, ease }}>
              {showCheck ? <Check size={14} weight="bold" aria-hidden /> : isCurrent ? <StepIcon size={14} weight="bold" aria-hidden /> : i + 1}
            </motion.span>
            <span className="tl-label">{s}</span>
            <span className="tl-sub">{sub}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ConfirmCancel({ order, onConfirm, onClose, busy }: { order: OrderDetail; onConfirm: () => void; onClose: () => void; busy: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>(true, onClose);
  const units = order.items.reduce((s, i) => s + i.quantity, 0);
  return (
    <motion.div className="scrim top" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div ref={ref} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cc-h" aria-describedby="cc-d" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: dur.base, ease } }} exit={{ opacity: 0, scale: 0.98, transition: { duration: dur.fast, ease: easeIn } }}>
        <div className="dialog-icon"><Warning size={22} weight="fill" aria-hidden /></div>
        <h2 id="cc-h">Cancel {order.ref}?</h2>
        <p id="cc-d">{units} unit{units > 1 ? 's' : ''} will be returned to stock. This can’t be undone.</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} data-autofocus>Keep order</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>{busy && <span className="spinner" aria-hidden />}Cancel order</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function OrderDrawer() {
  const { openRef, openOrder, version, refresh, toast } = useConsole();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const close = () => { if (!confirm) openOrder(null); };
  const ref = useFocusTrap<HTMLDivElement>(!!openRef && !confirm, close);

  useEffect(() => {
    setCopied(false);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    if (!openRef) { setOrder(null); return; }
    let active = true;
    api.order(openRef)
      .then((o) => { if (active) setOrder(o); })
      .catch((e) => {
        if (!active) return;
        toast({ tone: 'error', title: 'Order not found', body: e.message });
        openOrder(null);
      });
    return () => { active = false; };
  }, [openRef, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
  }, []);

  async function handleCopyRef() {
    if (!openRef) return;
    const ok = await copyText(openRef);
    if (ok) {
      setCopied(true);
      toast({ tone: 'success', title: 'Reference copied', body: openRef });
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } else {
      toast({ tone: 'error', title: 'Could not copy reference', body: 'Copy manually from the order header.' });
    }
  }

  async function move(status: Status) {
    if (!order) return;
    setBusy(true);
    try {
      const o = await api.setStatus(order.ref, status);
      setOrder(o);
      toast({ tone: 'success', title: `${o.ref} ${status.toLowerCase()}`, body: status === 'Cancelled' ? 'Stock has been restored.' : undefined });
    } catch (e) {
      toast({ tone: 'error', title: 'Update rejected', body: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirm(false);
      refresh();
    }
  }

  const next = order?.allowedTransitions.find((t) => t !== 'Cancelled');
  const canCancel = order?.allowedTransitions.includes('Cancelled');
  const totalUnits = order ? order.items.reduce((s, it) => s + it.quantity, 0) : 0;
  const itemsSubtotal = order ? order.items.reduce((s, it) => s + it.quantity * it.unitPriceCents, 0) : 0;
  const hasExplicitTax = order?.subtotalCents !== undefined && order?.taxCents !== undefined;
  const derivedTax = order ? Math.max(0, order.totalCents - itemsSubtotal) : 0;
  const subtotalCents = hasExplicitTax ? order!.subtotalCents! : itemsSubtotal;
  const taxCents = hasExplicitTax ? order!.taxCents! : (derivedTax > 0 ? derivedTax : null);

  return (
    <AnimatePresence>
      {openRef && (
        <motion.div key="scrim" className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: dur.fast } }} onClick={close}>
          <motion.div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-h" onClick={(e) => e.stopPropagation()}
            initial={{ x: '100%' }} animate={{ x: 0, transition: { duration: dur.slow, ease } }} exit={{ x: '100%', transition: { duration: dur.base, ease: easeIn } }}>
            <div className="drawer-head">
              <div>
                <span className="eyebrow">Order</span>
                <div className="drawer-ref-row">
                  <h2 id="dr-h" className="mono">{openRef}</h2>
                  <button
                    type="button"
                    className={'icon-btn sm copy-btn' + (copied ? ' copied' : '')}
                    onClick={handleCopyRef}
                    aria-label={copied ? 'Order reference copied' : `Copy order reference ${openRef}`}
                    title={copied ? 'Copied' : 'Copy reference'}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={copied ? 'check' : 'copy'}
                        initial={{ scale: 0.75, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.75, opacity: 0 }}
                        transition={{ duration: dur.fast }}
                        style={{ display: 'flex' }}
                      >
                        {copied ? <Check size={15} weight="bold" aria-hidden /> : <Copy size={15} aria-hidden />}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={close} aria-label="Close order details" data-autofocus><X size={18} aria-hidden /></button>
            </div>

            {!order ? (
              <div className="drawer-body"><div className="skeleton" style={{ height: 76 }} /><div className="skeleton" style={{ height: 160 }} /></div>
            ) : (
              <motion.div key={order.status} className="drawer-body" initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={{ duration: dur.base }}>
                <div className="meta-row">
                  <StatusBadge status={order.status} />
                  <span className="muted sm tabular">Created {new Date(order.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <Timeline status={order.status} />

                {(order.customerName || order.notes) && (
                  <div className="drawer-notes-card">
                    {order.customerName && (
                      <div className="drawer-note-row">
                        <User size={15} weight="bold" aria-hidden />
                        <div>
                          <span className="eyebrow">Customer</span>
                          <div className="strong">{order.customerName}</div>
                        </div>
                      </div>
                    )}
                    {order.notes && (
                      <div className="drawer-note-row">
                        <Note size={15} weight="bold" aria-hidden />
                        <div>
                          <span className="eyebrow">Notes</span>
                          <p className="drawer-notes-text">{order.notes}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="section-head">
                  <h3>Items</h3>
                  <span className="muted sm tabular">
                    {order.items.length} line{order.items.length !== 1 ? 's' : ''} · {totalUnits} unit{totalUnits !== 1 ? 's' : ''}
                  </span>
                </div>
                <ul className="items">
                  {order.items.map((it) => (
                    <li key={it.productId}>
                      <span className="prod-ico xs"><ProductIcon sku={it.sku} size={16} /></span>
                      <div className="grow item-info">
                        <span className="strong">{it.name}</span>
                        <span className="muted sm mono tabular">
                          {it.sku} · {it.quantity} × {money(it.unitPriceCents)}
                        </span>
                      </div>
                      <span className="mono tabular strong item-subtotal">{money(it.quantity * it.unitPriceCents)}</span>
                    </li>
                  ))}
                </ul>

                <div className="drawer-totals">
                  <div className="breakdown-row">
                    <span>Subtotal</span>
                    <span className="mono tabular">{money(subtotalCents)}</span>
                  </div>
                  {taxCents !== null && (
                    <div className="breakdown-row">
                      <span>Tax (8%)</span>
                      <span className="mono tabular">{money(taxCents)}</span>
                    </div>
                  )}
                  <div className="summary-total">
                    <span>Total</span>
                    <b className="mono tabular">{money(order.totalCents)}</b>
                  </div>
                </div>

                <div className="drawer-meta-grid">
                  <div>
                    <span className="eyebrow">Created</span>
                    <span className="muted sm tabular">{new Date(order.createdAt).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="eyebrow">Last updated</span>
                    <span className="muted sm tabular">{new Date(order.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </motion.div>
            )}

            {order && (
              <div className="drawer-foot">
                {next && (
                  <motion.button type="button" className="btn btn-primary btn-lg grow" onClick={() => move(next)} disabled={busy} whileTap={{ scale: 0.98 }}>
                    {busy && !confirm ? <span className="spinner" aria-hidden /> : next === 'Packed' ? <Package size={18} weight="bold" aria-hidden /> : <Truck size={18} weight="bold" aria-hidden />}
                    Mark as {next.toLowerCase()}
                  </motion.button>
                )}
                {canCancel && <button type="button" className="btn btn-danger-outline btn-lg" onClick={() => setConfirm(true)} disabled={busy}>Cancel order</button>}
                {!next && !canCancel && (
                  <div className="final-note"><LockSimple size={16} aria-hidden />This order is {order.status.toLowerCase()} and can’t be changed.</div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
      {confirm && order && <ConfirmCancel key="confirm" order={order} busy={busy} onClose={() => setConfirm(false)} onConfirm={() => move('Cancelled')} />}
    </AnimatePresence>
  );
}
