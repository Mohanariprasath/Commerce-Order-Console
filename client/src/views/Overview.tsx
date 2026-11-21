import { motion } from 'framer-motion';
import { ClipboardText, Package, Truck, CurrencyDollar, ArrowRight, ArrowUpRight, Warning, type Icon } from '@phosphor-icons/react';
import { useConsole } from '../state';
import { money } from '../api';
import { AnimatedNumber, ProductIcon, StatusBadge, StockPill, stockTone } from '../components/ui';
import { dur, ease, stagger } from '../motion';
import type { Status } from '../types';

function Kpi({
  i, label, value, hint, icon: I, tone, format, onClick, actionLabel,
}: {
  i: number;
  label: string;
  value: number;
  hint: string;
  icon: Icon;
  tone: string;
  format?: (n: number) => string;
  onClick: () => void;
  actionLabel: string;
}) {
  return (
    <motion.button
      type="button"
      className="card kpi kpi-btn"
      onClick={onClick}
      aria-label={actionLabel}
      title={actionLabel}
      {...stagger(i, 0.06)}
      whileHover={{ y: -2 }}
      transition={{ duration: dur.fast }}
    >
      <div className="kpi-head">
        <div className={`kpi-icon tone-${tone}`}><I size={20} weight="duotone" aria-hidden /></div>
        <ArrowUpRight size={16} className="kpi-arrow" aria-hidden />
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value"><AnimatedNumber value={value} format={format} /></div>
      <div className="kpi-hint">{hint}</div>
    </motion.button>
  );
}

const PIPE: Status[] = ['Placed', 'Packed', 'Shipped', 'Cancelled'];

export default function Overview() {
  const { orders, products, openOrder, go, loaded, setStatusFilter, setSearch } = useConsole();
  const count = (s: Status) => orders.filter((o) => o.status === s).length;
  const revenue = orders.filter((o) => o.status !== 'Cancelled').reduce((s, o) => s + o.totalCents, 0);
  const attention = products.filter((p) => stockTone(p.stock) !== 'ok');
  const sortedProducts = [...products].sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
  const total = orders.length || 1;

  const openFilteredOrders = (status: '' | Status) => {
    setStatusFilter(status);
    setSearch('');
    go('orders');
  };

  return (
    <div className="stack-lg">
      <div className="kpi-grid">
        <Kpi
          i={0}
          label="Awaiting packing"
          value={count('Placed')}
          hint="Placed orders"
          icon={ClipboardText}
          tone="blue"
          onClick={() => openFilteredOrders('Placed')}
          actionLabel="View Placed orders"
        />
        <Kpi
          i={1}
          label="Ready to ship"
          value={count('Packed')}
          hint="Packed, not shipped"
          icon={Package}
          tone="orange"
          onClick={() => openFilteredOrders('Packed')}
          actionLabel="View Packed orders"
        />
        <Kpi
          i={2}
          label="Shipped"
          value={count('Shipped')}
          hint="Completed orders"
          icon={Truck}
          tone="green"
          onClick={() => openFilteredOrders('Shipped')}
          actionLabel="View Shipped orders"
        />
        <Kpi
          i={3}
          label="Booked revenue"
          value={revenue}
          hint="Excludes cancelled"
          icon={CurrencyDollar}
          tone="slate"
          format={money}
          onClick={() => openFilteredOrders('')}
          actionLabel="View all orders"
        />
      </div>

      <motion.section className="card" {...stagger(4, 0.06)} aria-labelledby="pipe-h">
        <div className="card-head">
          <h2 id="pipe-h">Fulfilment pipeline</h2>
          <span className="muted tabular">{orders.length} order{orders.length === 1 ? '' : 's'} total</span>
        </div>
        <div className="pipeline" role="img" aria-label={PIPE.map((s) => `${count(s)} ${s}`).join(', ')}>
          {PIPE.map((s) => (
            <motion.div
              key={s}
              className={`pipe-seg seg-${s.toLowerCase()}`}
              initial={{ flexGrow: 0 }}
              animate={{ flexGrow: count(s) / total }}
              transition={{ duration: dur.slow * 2, ease }}
            />
          ))}
        </div>
        <div className="pipe-legend">
          {PIPE.map((s) => (
            <button
              key={s}
              type="button"
              className="legend-item"
              onClick={() => openFilteredOrders(s)}
              aria-label={`View ${count(s)} ${s.toLowerCase()} orders`}
              title={`Filter orders by ${s}`}
            >
              <StatusBadge status={s} /> <b className="tabular">{count(s)}</b>
            </button>
          ))}
        </div>
      </motion.section>

      <div className="two-col">
        <motion.section className="card" {...stagger(5, 0.06)} aria-labelledby="recent-h">
          <div className="card-head">
            <h2 id="recent-h">Recent orders</h2>
            <button type="button" className="btn btn-ghost sm" onClick={() => openFilteredOrders('')}>View all <ArrowRight size={14} aria-hidden /></button>
          </div>
          {loaded && orders.length === 0 ? (
            <div className="empty">
              <ClipboardText size={36} weight="duotone" aria-hidden />
              <p>No orders yet.</p>
              <button type="button" className="btn btn-primary sm" onClick={() => go('new')}>Create the first order</button>
            </div>
          ) : (
            <ul className="list">
              {orders.slice(0, 6).map((o, i) => (
                <motion.li key={o.ref} {...stagger(i)}>
                  <button type="button" className="list-row" onClick={() => openOrder(o.ref)}>
                    <span className="mono strong">{o.ref}</span>
                    <StatusBadge status={o.status} />
                    <span className="grow" />
                    <span className="mono tabular">{money(o.totalCents)}</span>
                    <span className="muted sm hide-sm tabular">{new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </motion.section>

        <motion.section className="card" {...stagger(6, 0.06)} aria-labelledby="inv-h">
          <div className="card-head">
            <h2 id="inv-h">Inventory health</h2>
            <div className="inv-head-meta">
              {attention.length > 0 && <span className="chip-warn"><Warning size={14} weight="bold" aria-hidden />{attention.length} need attention</span>}
              <span className="muted sm tabular">{products.length} SKUs</span>
            </div>
          </div>
          <ul className="list inv-scroll">
            {sortedProducts.map((p, i) => (
              <motion.li key={p.id} className="inv-row" {...stagger(i, 0.03)}>
                <span className="prod-ico sm"><ProductIcon sku={p.sku} size={18} /></span>
                <div className="inv-main">
                  <div className="inv-top">
                    <span className="strong inv-name" title={p.name}>{p.name}</span>
                    <StockPill stock={p.stock} />
                  </div>
                  <div className={`meter meter-${stockTone(p.stock)}`}><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, (p.stock / 40) * 100)}%` }} transition={{ duration: dur.slow * 2, ease }} /></div>
                </div>
              </motion.li>
            ))}
          </ul>
        </motion.section>
      </div>
    </div>
  );
}
