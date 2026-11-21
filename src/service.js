const STATUSES = ['Placed', 'Packed', 'Shipped', 'Cancelled'];
const TAX_RATE = 0.08;
const MAX_CUSTOMER_NAME = 120;
const MAX_NOTES = 500;
const MAX_ITEM_QTY = 1000;

// Allowed transitions: Placed -> Packed -> Shipped; cancel only from Placed/Packed.
const TRANSITIONS = {
  Placed: ['Packed', 'Cancelled'],
  Packed: ['Shipped', 'Cancelled'],
  Shipped: [],
  Cancelled: [],
};

class ApiError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeRef(ref) {
  return typeof ref === 'string' ? ref.trim().toUpperCase() : String(ref ?? '').trim().toUpperCase();
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore if already rolled back */ }
    throw e;
  }
}

function createService(db) {
  const q = {
    countProducts: db.prepare('SELECT COUNT(*) AS n FROM products'),
    countOrders: db.prepare('SELECT COUNT(*) AS n FROM orders'),
    products: db.prepare(
      'SELECT id, sku, name, brand, category, description, rating, price_cents AS priceCents, stock FROM products ORDER BY id',
    ),
    product: db.prepare('SELECT id, name, price_cents, stock FROM products WHERE id = ?'),
    deduct: db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?'),
    restore: db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?'),
    insOrder: db.prepare(
      'INSERT INTO orders (status,subtotal_cents,tax_cents,total_cents,customer_name,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ),
    setRef: db.prepare('UPDATE orders SET ref = ? WHERE id = ?'),
    insItem: db.prepare('INSERT INTO order_items (order_id,product_id,name,unit_price_cents,quantity) VALUES (?,?,?,?,?)'),
    byId: db.prepare('SELECT * FROM orders WHERE id = ?'),
    byRef: db.prepare('SELECT * FROM orders WHERE ref = ?'),
    items: db.prepare(`SELECT oi.product_id AS productId, p.sku, oi.name, oi.unit_price_cents AS unitPriceCents, oi.quantity
      FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`),
    // Guarded: only succeeds if the status is still what we validated => exactly-once effects.
    move: db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?'),
  };

  const shape = (o) => ({
    ref: o.ref,
    status: o.status,
    subtotalCents: o.subtotal_cents,
    taxCents: o.tax_cents,
    totalCents: o.total_cents,
    customerName: o.customer_name,
    notes: o.notes,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    allowedTransitions: TRANSITIONS[o.status],
  });
  const withItems = (o) => ({ ...shape(o), items: q.items.all(o.id) });

  function health() {
    return {
      ok: true,
      products: q.countProducts.get().n,
      orders: q.countOrders.get().n,
    };
  }

  function listProducts() {
    return q.products.all();
  }

  function listOrders({ search = '', status = '' } = {}) {
    if (status !== '' && (typeof status !== 'string' || !STATUSES.includes(status))) {
      throw new ApiError(400, 'INVALID_FILTER', `Unknown status "${status}"`);
    }
    const where = [];
    const args = [];
    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
      const pattern = '%' + term.toUpperCase().replace(/[\\%_]/g, '\\$&') + '%';
      where.push("(UPPER(ref) LIKE ? ESCAPE '\\' OR UPPER(customer_name) LIKE ? ESCAPE '\\')");
      args.push(pattern, pattern);
    }
    if (status) {
      where.push('status = ?');
      args.push(status);
    }
    const sql = `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
    return db.prepare(sql).all(...args).map(shape);
  }

  function getOrder(ref) {
    const norm = normalizeRef(ref);
    const o = norm ? q.byRef.get(norm) : undefined;
    if (!o) throw new ApiError(404, 'ORDER_NOT_FOUND', `Order ${ref} not found`);
    return withItems(o);
  }

  function createOrder(body) {
    if (!isPlainObject(body)) {
      throw new ApiError(400, 'VALIDATION', 'Request body must be a JSON object');
    }

    let customerName = '';
    if (body.customerName !== undefined) {
      if (typeof body.customerName !== 'string') {
        throw new ApiError(400, 'VALIDATION', 'customerName must be a string');
      }
      customerName = body.customerName.trim();
      if (customerName.length > MAX_CUSTOMER_NAME) {
        throw new ApiError(400, 'VALIDATION', `customerName must be at most ${MAX_CUSTOMER_NAME} characters`);
      }
    }

    let notes = '';
    if (body.notes !== undefined) {
      if (typeof body.notes !== 'string') {
        throw new ApiError(400, 'VALIDATION', 'notes must be a string');
      }
      notes = body.notes.trim();
      if (notes.length > MAX_NOTES) {
        throw new ApiError(400, 'VALIDATION', `notes must be at most ${MAX_NOTES} characters`);
      }
    }

    const raw = body.items;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ApiError(400, 'VALIDATION', 'An order needs at least one item');
    }

    // Validate + merge duplicate product lines.
    const wanted = new Map();
    for (const it of raw) {
      if (!isPlainObject(it)) {
        throw new ApiError(400, 'VALIDATION', 'Each item must be an object with productId and quantity');
      }
      const pid = it.productId;
      const qty = it.quantity;
      if (!Number.isInteger(pid) || pid < 1 || !Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) {
        throw new ApiError(
          400,
          'VALIDATION',
          `Each item needs a positive integer productId and an integer quantity between 1 and ${MAX_ITEM_QTY}`,
        );
      }
      const merged = (wanted.get(pid) || 0) + qty;
      if (merged > MAX_ITEM_QTY) {
        throw new ApiError(
          400,
          'VALIDATION',
          `Combined quantity for product ${pid} cannot exceed ${MAX_ITEM_QTY}`,
        );
      }
      wanted.set(pid, merged);
    }

    return tx(db, () => {
      const lines = [];
      const problems = [];
      for (const [pid, qty] of wanted) {
        const p = q.product.get(pid);
        if (!p) {
          problems.push({ productId: pid, reason: 'UNKNOWN_PRODUCT', message: `Product ${pid} does not exist` });
        } else if (p.stock < qty) {
          problems.push({
            productId: pid,
            name: p.name,
            requested: qty,
            available: p.stock,
            reason: p.stock === 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK',
            message: p.stock === 0 ? `${p.name} is out of stock` : `${p.name}: requested ${qty}, only ${p.stock} available`,
          });
        } else {
          lines.push({ p, pid, qty });
        }
      }
      if (problems.length) {
        // Nothing has been written yet; the ROLLBACK in tx() is just belt and braces.
        throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Order rejected: ' + problems.map((x) => x.message).join('; '), problems);
      }
      const now = new Date().toISOString();
      const subtotalCents = lines.reduce((s, l) => s + l.p.price_cents * l.qty, 0);
      const taxCents = Math.round(subtotalCents * TAX_RATE);
      const totalCents = subtotalCents + taxCents;
      const { lastInsertRowid: id } = q.insOrder.run(
        'Placed',
        subtotalCents,
        taxCents,
        totalCents,
        customerName,
        notes,
        now,
        now,
      );
      q.setRef.run('ORD-' + String(id).padStart(6, '0'), id);
      for (const l of lines) {
        const r = q.deduct.run(l.qty, l.pid, l.qty);
        if (r.changes !== 1) throw new ApiError(409, 'INSUFFICIENT_STOCK', `Stock changed for ${l.p.name}`);
        q.insItem.run(id, l.pid, l.p.name, l.p.price_cents, l.qty);
      }
      return withItems(q.byId.get(id));
    });
  }

  function changeStatus(ref, target) {
    if (typeof target !== 'string' || !STATUSES.includes(target)) {
      throw new ApiError(
        400,
        'VALIDATION',
        typeof target !== 'string' || !target.trim()
          ? 'A valid status string is required'
          : `Unknown status "${target}"`,
      );
    }
    const norm = normalizeRef(ref);
    return tx(db, () => {
      const o = norm ? q.byRef.get(norm) : undefined;
      if (!o) throw new ApiError(404, 'ORDER_NOT_FOUND', `Order ${ref} not found`);
      if (!TRANSITIONS[o.status].includes(target)) {
        throw new ApiError(
          409,
          'INVALID_TRANSITION',
          `Cannot change order ${o.ref} from ${o.status} to ${target}`,
          { from: o.status, to: target, allowed: TRANSITIONS[o.status] },
        );
      }
      const r = q.move.run(target, new Date().toISOString(), o.id, o.status);
      if (r.changes !== 1) throw new ApiError(409, 'INVALID_TRANSITION', 'Order was changed concurrently');
      if (target === 'Cancelled') {
        for (const it of q.items.all(o.id)) q.restore.run(it.quantity, it.productId);
      }
      return withItems(q.byId.get(o.id));
    });
  }

  return { health, listProducts, listOrders, getOrder, createOrder, changeStatus };
}

module.exports = { createService, ApiError, TRANSITIONS, STATUSES, TAX_RATE };
