import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Minus, Plus, Trash, ShoppingCartSimple, WarningCircle, ArrowRight, Prohibit,
  MagnifyingGlass, X, Star, Check, WifiSlash, Package, FunnelSimple,
} from '@phosphor-icons/react';
import { useConsole } from '../state';
import { ApiError, api, computeTotals, money } from '../api';
import { AnimatedNumber, ProductIcon, StockPill, stockTone } from '../components/ui';
import { dur, ease, easeIn, spring, stagger } from '../motion';
import type { Product, StockProblem } from '../types';

function Stepper({
  value, max, onChange, label, disabled = false,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const safeMax = Math.max(1, max);
  const clamped = Math.min(safeMax, Math.max(1, value));
  return (
    <div className={'stepper-input' + (disabled ? ' disabled' : '')} role="group" aria-label={label}>
      <button
        type="button"
        className="icon-btn sm"
        onClick={() => onChange(Math.max(1, clamped - 1))}
        disabled={disabled || clamped <= 1}
        aria-label="Decrease quantity"
      >
        <Minus size={14} weight="bold" aria-hidden />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={safeMax}
        value={disabled ? 0 : clamped}
        disabled={disabled}
        aria-label="Quantity"
        onChange={(e) => {
          const parsed = Math.floor(Number(e.target.value));
          if (!Number.isFinite(parsed) || parsed < 1) {
            onChange(1);
          } else {
            onChange(Math.min(safeMax, parsed));
          }
        }}
      />
      <button
        type="button"
        className="icon-btn sm"
        onClick={() => onChange(Math.min(safeMax, clamped + 1))}
        disabled={disabled || clamped >= safeMax}
        aria-label="Increase quantity"
      >
        <Plus size={14} weight="bold" aria-hidden />
      </button>
    </div>
  );
}

function ProductCard({ p, i, inCart, onAdd }: { p: Product; i: number; inCart: number; onAdd: (n: number) => void }) {
  const [qty, setQty] = useState(1);
  const remaining = Math.max(0, p.stock - inCart);
  const out = p.stock === 0;
  const tone = stockTone(p.stock);

  useEffect(() => {
    if (remaining > 0 && qty > remaining) setQty(remaining);
    if (remaining > 0 && qty < 1) setQty(1);
  }, [remaining, qty]);

  const effectiveQty = remaining > 0 ? Math.min(qty, remaining) : 1;

  return (
    <motion.article
      className={`card product tone-${tone}` + (inCart > 0 ? ' has-in-cart' : '')}
      {...stagger(i, 0.035)}
      whileHover={out ? undefined : { y: -2 }}
      transition={{ duration: dur.fast }}
      aria-label={p.name}
    >
      <div className="product-top">
        <span className="prod-ico"><ProductIcon sku={p.sku} /></span>
        <div className="product-top-right">
          <StockPill stock={p.stock} />
          <AnimatePresence>
            {inCart > 0 && (
              <motion.span
                className="in-cart"
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.88 }}
                transition={spring}
              >
                <Check size={11} weight="bold" aria-hidden />
                <span className="tabular">{inCart} in order</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="product-head">
        {(p.brand || p.category) && (
          <div className="product-meta">
            {p.brand && <span className="product-brand">{p.brand}</span>}
            {p.category && <span className="product-cat">{p.category}</span>}
          </div>
        )}
        <h3>{p.name}</h3>
        <div className="product-sub">
          <span className="mono muted sm">{p.sku}</span>
          {typeof p.rating === 'number' && (
            <span className="product-rating tabular" aria-label={`Rated ${p.rating.toFixed(1)} out of 5`}>
              <Star size={13} weight="fill" aria-hidden />
              {p.rating.toFixed(1)}
            </span>
          )}
        </div>
        {p.description && <p className="product-desc">{p.description}</p>}
      </div>

      <div className="product-footer">
        <div className="product-price-row">
          <div className="product-price mono tabular">{money(p.priceCents)}</div>
          {!out && inCart > 0 && (
            <span className={'avail-note tabular' + (remaining === 0 ? ' avail-max' : '')}>
              {remaining > 0 ? `${remaining} left to add` : `Max (${p.stock}) added`}
            </span>
          )}
        </div>
        {out ? (
          <div className="product-out"><Prohibit size={16} aria-hidden /> Unavailable: out of stock</div>
        ) : (
          <div className="product-actions">
            <Stepper
              value={effectiveQty}
              max={Math.max(1, remaining)}
              disabled={remaining <= 0}
              onChange={(n) => setQty(Math.min(Math.max(1, remaining), Math.max(1, n)))}
              label={`Quantity for ${p.name}`}
            />
            <motion.button
              type="button"
              className="btn btn-secondary"
              whileTap={remaining > 0 ? { scale: 0.97 } : undefined}
              disabled={remaining <= 0}
              onClick={() => {
                if (remaining <= 0) return;
                onAdd(Math.min(effectiveQty, remaining));
                setQty(1);
              }}
            >
              {remaining <= 0 ? 'All in order' : <><Plus size={16} weight="bold" aria-hidden /> Add</>}
            </motion.button>
          </div>
        )}
      </div>
    </motion.article>
  );
}

export default function NewOrder() {
  const {
    products, loaded, online, cart, setCart, customerName, setCustomerName, notes, setNotes,
    refresh, toast, openOrder, go, setStatusFilter, setSearch,
  } = useConsole();
  const [query, setQuery] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [problems, setProblems] = useState<StockProblem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (problems) errRef.current?.focus(); }, [problems]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const p of products) {
      if (p.category) seen.add(p.category);
    }
    return Array.from(seen);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (inStockOnly && p.stock <= 0) return false;
      if (selectedCategory && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q)
        || p.sku.toLowerCase().includes(q)
        || (p.brand?.toLowerCase().includes(q) ?? false)
        || (p.category?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [products, query, inStockOnly, selectedCategory]);

  const hasCatalogueFilters = Boolean(query.trim() || inStockOnly || selectedCategory);
  const resetCatalogueFilters = () => {
    setQuery('');
    setInStockOnly(false);
    setSelectedCategory('');
  };

  const problemIds = useMemo(() => new Set(problems?.map((p) => p.productId) ?? []), [problems]);

  const lines = Object.entries(cart)
    .map(([id, q]) => ({ p: products.find((x) => x.id === Number(id))!, q }))
    .filter((l) => l.p);
  const subtotal = lines.reduce((s, l) => s + l.p.priceCents * l.q, 0);
  const { taxCents: tax, totalCents: total } = computeTotals(subtotal);
  const units = lines.reduce((s, l) => s + l.q, 0);

  const setLine = (id: number, q: number | null) => {
    const prod = products.find((x) => x.id === id);
    const next = { ...cart };
    if (q === null || q <= 0 || !prod || prod.stock <= 0) {
      delete next[id];
    } else {
      next[id] = Math.min(prod.stock, Math.max(1, Math.floor(q)));
    }
    setCart(next);
    setProblems(null);
  };

  const handleClear = () => {
    setCart({});
    setCustomerName('');
    setNotes('');
    setProblems(null);
  };

  async function submit() {
    setBusy(true);
    setProblems(null);
    try {
      const o = await api.place({
        items: lines.map((l) => ({ productId: l.p.id, quantity: l.q })),
        customerName: customerName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setCart({});
      setCustomerName('');
      setNotes('');
      toast({
        tone: 'success',
        title: `Order ${o.ref} placed`,
        body: `${units} item${units !== 1 ? 's' : ''} · ${money(o.totalCents)}. Stock deducted.`,
      });
      await refresh();
      setStatusFilter('');
      setSearch('');
      go('orders');
      openOrder(o.ref);
    } catch (e) {
      const err = e as ApiError;
      setProblems(err.details ?? [{ productId: 0, message: err.message }]);
      toast({ tone: 'error', title: 'Order rejected', body: 'No order was created and stock is unchanged.' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const inStockCount = products.filter((p) => p.stock > 0).length;

  return (
    <div className="order-layout">
      <section aria-labelledby="cat-h">
        <div className="cat-header">
          <div className="section-head">
            <h2 id="cat-h">Catalogue</h2>
            <span className="muted sm tabular">
              {hasCatalogueFilters
                ? `Showing ${filteredProducts.length} of ${products.length} · ${inStockCount} in stock`
                : `${inStockCount} of ${products.length} available`}
            </span>
          </div>

          <div className="cat-toolbar">
            <label className="search cat-search">
              <MagnifyingGlass size={16} aria-hidden />
              <input
                type="search"
                placeholder="Search by product, SKU, brand, or category…"
                aria-label="Search products by name, SKU, brand, or category"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="icon-btn sm"
                  onClick={() => setQuery('')}
                  aria-label="Clear product search"
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </label>

            <button
              type="button"
              role="switch"
              aria-checked={inStockOnly}
              className={'stock-toggle' + (inStockOnly ? ' on' : '')}
              onClick={() => setInStockOnly((v) => !v)}
            >
              <span className="toggle-track" aria-hidden>
                <span className="toggle-thumb" />
              </span>
              <span>In stock only</span>
            </button>
          </div>

          {categories.length > 0 && (
            <div className="cat-chips" role="group" aria-label="Filter by category">
              <button
                type="button"
                className={'cat-chip' + (selectedCategory === '' ? ' active' : '')}
                aria-pressed={selectedCategory === ''}
                onClick={() => setSelectedCategory('')}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={'cat-chip' + (selectedCategory === cat ? ' active' : '')}
                  aria-pressed={selectedCategory === cat}
                  onClick={() => setSelectedCategory((c) => (c === cat ? '' : cat))}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {!loaded && products.length === 0 ? (
          <div className="product-grid">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="card skeleton" style={{ height: 248 }} />)}
          </div>
        ) : loaded && products.length === 0 ? (
          <div className="card empty">
            {online ? <Package size={40} weight="duotone" aria-hidden /> : <WifiSlash size={40} weight="duotone" aria-hidden />}
            <p className="strong">{online ? 'No products in the catalogue' : 'Unable to load product catalogue'}</p>
            <p className="muted sm">{online ? 'Products will appear here once inventory is populated.' : 'Check your server connection and try refreshing.'}</p>
            <button type="button" className="btn btn-secondary sm" onClick={() => refresh()}>
              {online ? 'Refresh catalogue' : 'Retry connection'}
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="card empty">
            <FunnelSimple size={40} weight="duotone" aria-hidden />
            <p className="strong">No matching products</p>
            <p className="muted sm">
              {query.trim()
                ? `Nothing matched “${query.trim()}”${inStockOnly ? ' in stock' : ''}${selectedCategory ? ` in ${selectedCategory}` : ''}.`
                : 'No products match the active catalogue filters.'}
            </p>
            <button type="button" className="btn btn-secondary sm" onClick={resetCatalogueFilters}>
              Reset filters
            </button>
          </div>
        ) : (
          <div className="product-grid">
            {filteredProducts.map((p, i) => (
              <ProductCard
                key={p.id}
                p={p}
                i={i}
                inCart={cart[p.id] ?? 0}
                onAdd={(n) => setLine(p.id, Math.min(p.stock, (cart[p.id] ?? 0) + n))}
              />
            ))}
          </div>
        )}
      </section>

      <motion.aside className="card summary" aria-labelledby="sum-h" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0, transition: { duration: dur.base, ease, delay: 0.1 } }}>
        <div className="card-head">
          <h2 id="sum-h">Order summary</h2>
          {units > 0 && <span className="muted sm tabular">{lines.length} line{lines.length !== 1 ? 's' : ''} · {units} unit{units !== 1 ? 's' : ''}</span>}
        </div>

        <div className="summary-lines">
          <AnimatePresence initial={false}>
            {lines.map((l) => {
              const left = Math.max(0, l.p.stock - l.q);
              const hasIssue = problemIds.has(l.p.id);
              return (
                <motion.div
                  key={l.p.id}
                  className={'summary-line' + (hasIssue ? ' has-problem' : '')}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto', transition: { duration: dur.base, ease } }}
                  exit={{ opacity: 0, height: 0, transition: { duration: dur.fast, ease: easeIn } }}
                >
                  <div className="sl-inner">
                    <span className="prod-ico xs"><ProductIcon sku={l.p.sku} size={16} /></span>
                    <div className="sl-name">
                      <span className="strong">{l.p.name}</span>
                      <span className="muted sm mono tabular">
                        {money(l.p.priceCents)} each
                        {left === 0 ? ' · max stock' : left <= 3 ? ` · ${left} left` : ''}
                      </span>
                    </div>
                    <Stepper
                      value={l.q}
                      max={l.p.stock}
                      onChange={(n) => setLine(l.p.id, n)}
                      label={`Quantity of ${l.p.name} in order`}
                    />
                    <span className="mono tabular sl-total">{money(l.p.priceCents * l.q)}</span>
                    <button type="button" className="icon-btn sm danger" onClick={() => setLine(l.p.id, null)} aria-label={`Remove ${l.p.name}`} title={`Remove ${l.p.name}`}>
                      <Trash size={16} aria-hidden />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {lines.length === 0 && (
            <div className="empty compact">
              <ShoppingCartSimple size={32} weight="duotone" aria-hidden />
              <p className="strong">Your order is empty</p>
              <p className="muted sm">Pick a quantity and click Add on any available product.</p>
            </div>
          )}
        </div>

        <div className="summary-fields">
          <div className="field">
            <label htmlFor="order-customer">
              Customer name <span className="opt-tag">Optional</span>
            </label>
            <input
              id="order-customer"
              type="text"
              maxLength={120}
              placeholder="Caller or company name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="order-notes">
              Order notes <span className="opt-tag">Optional</span>
            </label>
            <textarea
              id="order-notes"
              rows={2}
              maxLength={500}
              placeholder="Delivery instructions, phone callback… (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="summary-breakdown">
          <div className="breakdown-row">
            <span>Subtotal</span>
            <span className="mono tabular">{money(subtotal)}</span>
          </div>
          <div className="breakdown-row">
            <span>Tax (8%)</span>
            <span className="mono tabular">{money(tax)}</span>
          </div>
          <div className="summary-total">
            <span>Total</span>
            <b className="mono tabular"><AnimatedNumber value={total} format={money} /></b>
          </div>
        </div>

        <AnimatePresence>
          {problems && (
            <motion.div ref={errRef} tabIndex={-1} className="alert alert-error" role="alert"
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.4 } }} exit={{ opacity: 0, transition: { duration: dur.fast } }}>
              <WarningCircle size={20} weight="fill" aria-hidden />
              <div className="grow">
                <b>Order rejected. Nothing was changed.</b>
                <ul>{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
              </div>
              <button type="button" className="icon-btn sm" onClick={() => setProblems(null)} aria-label="Dismiss error">
                <X size={14} aria-hidden />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="summary-actions">
          <motion.button type="button" className="btn btn-primary btn-lg" disabled={!lines.length || busy} onClick={submit} whileTap={{ scale: 0.98 }} aria-busy={busy}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            {busy ? 'Placing order…' : <>Place order <ArrowRight size={16} weight="bold" aria-hidden /></>}
          </motion.button>
          <button type="button" className="btn btn-ghost" disabled={!lines.length || busy} onClick={handleClear}>Clear</button>
        </div>
        <p className="fineprint">Stock is checked and reserved on the server when you place the order.</p>
      </motion.aside>
    </div>
  );
}
