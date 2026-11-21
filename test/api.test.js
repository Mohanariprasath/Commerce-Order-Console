const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { open, seed } = require('../src/db');
const { TAX_RATE } = require('../src/service');
const { createApp } = require('../src/server');

async function boot(file = ':memory:') {
  const db = open(file);
  seed(db);
  const server = createApp(db);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const raw = async (method, url, bodyText, headers = {}) => {
    const r = await fetch(base + url, {
      method,
      headers,
      body: bodyText,
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, headers: r.headers, body, text };
  };
  const call = (method, url, body) =>
    raw(
      method,
      url,
      body !== undefined ? JSON.stringify(body) : undefined,
      { 'Content-Type': 'application/json' },
    );
  const close = () => new Promise((r) => { server.close(() => { db.close(); r(); }); });
  return { call, raw, close, base };
}

const stockOf = async (call, id) => (await call('GET', '/api/products')).body.find((p) => p.id === id).stock;
// Seed (12 products):
// 1 = Logitech MX Master 3S Wireless Mouse ($99.99, 25)
// 2 = Keychron K2 Wireless Mechanical Keyboard ($89.99, 5)
// 4 = Anker 7-in-1 USB-C Hub ($25.99, 40)
// 5 = Sony WH-1000XM5 Wireless Headphones ($349.99, 0)

test('GET /api/health reports status and live counts', async () => {
  const { call, close } = await boot();
  try {
    const before = await call('GET', '/api/health');
    assert.equal(before.status, 200);
    assert.deepEqual(before.body, { ok: true, products: 12, orders: 0 });

    const placed = await call('POST', '/api/orders', { items: [{ productId: 1, quantity: 1 }] });
    assert.equal(placed.status, 201);

    const after = await call('GET', '/api/health');
    assert.equal(after.status, 200);
    assert.deepEqual(after.body, { ok: true, products: 12, orders: 1 });
  } finally {
    await close();
  }
});

test('GET /api/products returns enriched 12-item catalogue with brand, category, description, and rating', async () => {
  const { call, close } = await boot();
  try {
    const res = await call('GET', '/api/products');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 12);
    assert.deepEqual(res.body[0], {
      id: 1,
      sku: 'WID-001',
      name: 'Logitech MX Master 3S Wireless Mouse',
      brand: 'Logitech',
      category: 'Peripherals',
      description: '8K DPI sensor, quiet clicks, MagSpeed scroll wheel, USB-C',
      rating: 4.7,
      priceCents: 9999,
      stock: 25,
    });
    assert.equal(res.body[1].stock, 5);
    assert.equal(res.body[4].stock, 0);
    assert.equal(res.body[11].sku, 'KDL-012');
    assert.equal(res.body[11].stock, 0);
  } finally {
    await close();
  }
});

test('successful placement deducts stock, calculates subtotal/tax/total, and includes SKU on items', async () => {
  const { call, close } = await boot();
  try {
    const r = await call('POST', '/api/orders', {
      items: [
        { productId: 2, quantity: 2 },
        { productId: 1, quantity: 1 },
      ],
    });
    assert.equal(r.status, 201);
    const expectedSubtotal = 2 * 8999 + 9999;
    const expectedTax = Math.round(expectedSubtotal * TAX_RATE);
    const expectedTotal = expectedSubtotal + expectedTax;

    assert.equal(r.body.status, 'Placed');
    assert.equal(r.body.subtotalCents, expectedSubtotal);
    assert.equal(r.body.taxCents, expectedTax);
    assert.equal(r.body.totalCents, expectedTotal);
    assert.equal(r.body.customerName, '');
    assert.equal(r.body.notes, '');
    assert.match(r.body.ref, /^ORD-\d{6}$/);
    assert.deepEqual(r.body.items, [
      { productId: 2, sku: 'KEY-002', name: 'Keychron K2 Wireless Mechanical Keyboard', unitPriceCents: 8999, quantity: 2 },
      { productId: 1, sku: 'WID-001', name: 'Logitech MX Master 3S Wireless Mouse', unitPriceCents: 9999, quantity: 1 },
    ]);
    assert.equal(await stockOf(call, 2), 3);
    assert.equal(await stockOf(call, 1), 24);

    // Verify GET /api/orders/:ref returns identical item fields including SKU
    const detail = await call('GET', `/api/orders/${r.body.ref}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.items, r.body.items);
    assert.equal(detail.body.subtotalCents, expectedSubtotal);
    assert.equal(detail.body.taxCents, expectedTax);
    assert.equal(detail.body.totalCents, expectedTotal);
  } finally {
    await close();
  }
});

test('optional customerName and notes are trimmed, returned everywhere, and validated', async () => {
  const { call, close } = await boot();
  try {
    const created = await call('POST', '/api/orders', {
      customerName: '  Ada Lovelace  ',
      notes: '  Leave at front desk  ',
      items: [{ productId: 1, quantity: 1 }],
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.customerName, 'Ada Lovelace');
    assert.equal(created.body.notes, 'Leave at front desk');

    const listed = await call('GET', '/api/orders');
    assert.equal(listed.status, 200);
    assert.equal(listed.body[0].customerName, 'Ada Lovelace');
    assert.equal(listed.body[0].notes, 'Leave at front desk');

    const detail = await call('GET', `/api/orders/${created.body.ref}`);
    assert.equal(detail.body.customerName, 'Ada Lovelace');
    assert.equal(detail.body.notes, 'Leave at front desk');

    const moved = await call('POST', `/api/orders/${created.body.ref}/status`, { status: 'Packed' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.customerName, 'Ada Lovelace');
    assert.equal(moved.body.notes, 'Leave at front desk');

    // Exact boundary lengths succeed
    const boundary = await call('POST', '/api/orders', {
      customerName: 'A'.repeat(120),
      notes: 'N'.repeat(500),
      items: [{ productId: 1, quantity: 1 }],
    });
    assert.equal(boundary.status, 201);
    assert.equal(boundary.body.customerName.length, 120);
    assert.equal(boundary.body.notes.length, 500);

    // Invalid types or excessive lengths return 400
    for (const badName of [123, null, ['Ada'], { name: 'Ada' }, 'A'.repeat(121)]) {
      const res = await call('POST', '/api/orders', {
        customerName: badName,
        items: [{ productId: 1, quantity: 1 }],
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION');
    }
    for (const badNotes of [456, null, true, ['note'], 'N'.repeat(501)]) {
      const res = await call('POST', '/api/orders', {
        notes: badNotes,
        items: [{ productId: 1, quantity: 1 }],
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION');
    }
  } finally {
    await close();
  }
});

test('acceptance example 1: insufficient stock rejects whole order; A stays 5 and no order created', async () => {
  const { call, close } = await boot();
  try {
    const r = await call('POST', '/api/orders', {
      items: [
        { productId: 2, quantity: 2 },
        { productId: 5, quantity: 1 },
      ],
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'INSUFFICIENT_STOCK');
    assert.equal(r.body.error.details[0].reason, 'OUT_OF_STOCK');
    assert.equal(await stockOf(call, 2), 5);
    assert.equal(await stockOf(call, 5), 0);
    assert.equal((await call('GET', '/api/orders')).body.length, 0);
  } finally {
    await close();
  }
});

test('duplicate product lines merge quantities and reject atomically when combined qty exceeds stock', async () => {
  const { call, close } = await boot();
  try {
    // 3 + 3 = 6 > 5 available on product 2, alongside valid product 1 -> whole order rejected
    const fail = await call('POST', '/api/orders', {
      items: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 3 },
        { productId: 2, quantity: 3 },
      ],
    });
    assert.equal(fail.status, 409);
    assert.equal(fail.body.error.code, 'INSUFFICIENT_STOCK');
    assert.equal(fail.body.error.details[0].requested, 6);
    assert.equal(fail.body.error.details[0].available, 5);
    assert.equal(await stockOf(call, 1), 25);
    assert.equal(await stockOf(call, 2), 5);
    assert.equal((await call('GET', '/api/orders')).body.length, 0);

    // Combined quantity > 1000 rejected with 400
    const tooMany = await call('POST', '/api/orders', {
      items: [
        { productId: 1, quantity: 600 },
        { productId: 1, quantity: 401 },
      ],
    });
    assert.equal(tooMany.status, 400);

    // Duplicate lines within stock merge into one line item
    const ok = await call('POST', '/api/orders', {
      items: [
        { productId: 2, quantity: 2 },
        { productId: 2, quantity: 1 },
      ],
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.items.length, 1);
    assert.equal(ok.body.items[0].quantity, 3);
    assert.equal(ok.body.subtotalCents, 3 * 8999);
    assert.equal(ok.body.taxCents, Math.round(3 * 8999 * TAX_RATE));
    assert.equal(ok.body.totalCents, ok.body.subtotalCents + ok.body.taxCents);
    assert.equal(await stockOf(call, 2), 2);
  } finally {
    await close();
  }
});

test('acceptance example 2: cancel from Placed restores stock to 5 and repeat cancel fails with 409', async () => {
  const { call, close } = await boot();
  try {
    const { body: o } = await call('POST', '/api/orders', { items: [{ productId: 2, quantity: 2 }] });
    assert.equal(await stockOf(call, 2), 3);

    const first = await call('POST', `/api/orders/${o.ref}/status`, { status: 'Cancelled' });
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'Cancelled');
    assert.equal(await stockOf(call, 2), 5);

    const second = await call('POST', `/api/orders/${o.ref}/status`, { status: 'Cancelled' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'INVALID_TRANSITION');
    assert.equal(await stockOf(call, 2), 5);
  } finally {
    await close();
  }
});

test('cancel from Packed restores stock exactly once and repeat cancel fails', async () => {
  const { call, close } = await boot();
  try {
    const { body: o } = await call('POST', '/api/orders', { items: [{ productId: 2, quantity: 2 }] });
    assert.equal(await stockOf(call, 2), 3);

    const packed = await call('POST', `/api/orders/${o.ref}/status`, { status: 'Packed' });
    assert.equal(packed.status, 200);
    assert.equal(await stockOf(call, 2), 3);

    const cancelled = await call('POST', `/api/orders/${o.ref}/status`, { status: 'Cancelled' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, 'Cancelled');
    assert.equal(await stockOf(call, 2), 5);

    const repeat = await call('POST', `/api/orders/${o.ref}/status`, { status: 'Cancelled' });
    assert.equal(repeat.status, 409);
    assert.equal(await stockOf(call, 2), 5);
  } finally {
    await close();
  }
});

test('full invalid state transition matrix and case-insensitive ref lookup', async () => {
  const { call, close } = await boot();
  try {
    // Order 1: test Placed -> Packed -> Shipped forbidden transitions
    const { body: o1 } = await call('POST', '/api/orders', { items: [{ productId: 2, quantity: 1 }] });
    const lowerRef = o1.ref.toLowerCase();

    // Case-insensitive GET works
    const fetchedLower = await call('GET', `/api/orders/${lowerRef}`);
    assert.equal(fetchedLower.status, 200);
    assert.equal(fetchedLower.body.ref, o1.ref);

    // Forbidden from Placed: Shipped, Placed
    for (const target of ['Shipped', 'Placed']) {
      const r = await call('POST', `/api/orders/${lowerRef}/status`, { status: target });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'INVALID_TRANSITION');
    }
    assert.equal((await call('GET', `/api/orders/${o1.ref}`)).body.status, 'Placed');

    // Valid: Placed -> Packed (using lowercase ref)
    assert.equal((await call('POST', `/api/orders/${lowerRef}/status`, { status: 'Packed' })).status, 200);

    // Forbidden from Packed: Placed, Packed
    for (const target of ['Placed', 'Packed']) {
      const r = await call('POST', `/api/orders/${o1.ref}/status`, { status: target });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'INVALID_TRANSITION');
    }

    // Valid: Packed -> Shipped
    assert.equal((await call('POST', `/api/orders/${o1.ref}/status`, { status: 'Shipped' })).status, 200);

    // Forbidden from Shipped: all statuses
    for (const target of ['Placed', 'Packed', 'Shipped', 'Cancelled']) {
      const r = await call('POST', `/api/orders/${o1.ref}/status`, { status: target });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'INVALID_TRANSITION');
    }

    // Order 2: test Cancelled -> all statuses forbidden
    const { body: o2 } = await call('POST', '/api/orders', { items: [{ productId: 1, quantity: 1 }] });
    assert.equal((await call('POST', `/api/orders/${o2.ref}/status`, { status: 'Cancelled' })).status, 200);
    for (const target of ['Placed', 'Packed', 'Shipped', 'Cancelled']) {
      const r = await call('POST', `/api/orders/${o2.ref}/status`, { status: target });
      assert.equal(r.status, 409);
      assert.equal(r.body.error.code, 'INVALID_TRANSITION');
    }

    // Unknown / missing / non-string status -> 400
    for (const payload of [{ status: 'Bogus' }, { status: '' }, {}, { status: null }, { status: 123 }, { status: ['Packed'] }]) {
      const r = await call('POST', `/api/orders/${o1.ref}/status`, payload);
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, 'VALIDATION');
    }
  } finally {
    await close();
  }
});

test('malformed JSON, non-object bodies, bad URL encoding, invalid quantities, unknown product, and HTTP edge cases', async () => {
  const { call, raw, close } = await boot();
  try {
    const { body: o } = await call('POST', '/api/orders', { items: [{ productId: 1, quantity: 1 }] });

    // Malformed JSON
    const badJson = await raw('POST', '/api/orders', '{not-json', { 'Content-Type': 'application/json' });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.error.code, 'BAD_JSON');

    // Non-object JSON bodies (null, array, string, number, boolean)
    for (const literal of ['null', '[]', '"text"', '42', 'true']) {
      const r1 = await raw('POST', '/api/orders', literal, { 'Content-Type': 'application/json' });
      assert.equal(r1.status, 400);
      assert.equal(r1.body.error.code, 'VALIDATION');

      const r2 = await raw('POST', `/api/orders/${o.ref}/status`, literal, { 'Content-Type': 'application/json' });
      assert.equal(r2.status, 400);
      assert.equal(r2.body.error.code, 'VALIDATION');
    }

    // Bad URL percent-encoding -> 400 (never 500)
    assert.equal((await raw('GET', '/api/orders/%E0%A4%A')).status, 400);
    assert.equal((await raw('POST', '/api/orders/%E0%A4%A/status', '{"status":"Packed"}', { 'Content-Type': 'application/json' })).status, 400);
    assert.equal((await raw('GET', '/%E0%A4%A')).status, 400);

    // Empty items, bad item shapes, negative/zero/float/huge quantities, bad productIds
    for (const payload of [
      { items: [] },
      { items: 'not-an-array' },
      { items: [null] },
      { items: [{ productId: 1, quantity: 0 }] },
      { items: [{ productId: 1, quantity: -2 }] },
      { items: [{ productId: 1, quantity: 1.5 }] },
      { items: [{ productId: 1, quantity: 1001 }] },
      { items: [{ productId: 1, quantity: 1e9 }] },
      { items: [{ productId: 0, quantity: 1 }] },
      { items: [{ productId: -1, quantity: 1 }] },
      { items: [{ productId: 1.5, quantity: 1 }] },
      { items: [{ productId: '1', quantity: 1 }] },
    ]) {
      const r = await call('POST', '/api/orders', payload);
      assert.equal(r.status, 400);
    }

    // Unknown positive productId -> 409 UNKNOWN_PRODUCT
    const unknown = await call('POST', '/api/orders', { items: [{ productId: 99, quantity: 1 }] });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.body.error.details[0].reason, 'UNKNOWN_PRODUCT');

    // Unknown order ref -> 404
    assert.equal((await call('GET', '/api/orders/ORD-999999')).status, 404);
    assert.equal((await call('POST', '/api/orders/ORD-999999/status', { status: 'Packed' })).status, 404);

    // Unknown API routes -> 404 JSON
    for (const path404 of ['/api', '/api/unknown', '/api/orders/ORD-000001/extra']) {
      const r = await raw('GET', path404);
      assert.equal(r.status, 404);
      assert.equal(r.body.error.code, 'NOT_FOUND');
    }

    // Invalid HTTP methods -> 405 JSON with Allow header
    for (const [method, url] of [
      ['POST', '/api/health'],
      ['DELETE', '/api/products'],
      ['PUT', '/api/orders'],
      ['DELETE', `/api/orders/${o.ref}`],
      ['GET', `/api/orders/${o.ref}/status`],
      ['POST', '/'],
    ]) {
      const r = await raw(method, url);
      assert.equal(r.status, 405);
      assert.equal(r.body.error.code, 'METHOD_NOT_ALLOWED');
      assert.ok(r.headers.get('allow'));
    }

    // Static file caching & path traversal protection
    const idx = await raw('GET', '/');
    assert.equal(idx.status, 200);
    assert.equal(idx.headers.get('cache-control'), 'no-cache');

    const assetsDir = path.join(__dirname, '..', 'public', 'assets');
    const firstAsset = fs.readdirSync(assetsDir)[0];
    if (firstAsset) {
      const asset = await raw('GET', `/assets/${firstAsset}`);
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    }

    for (const traversal of ['/%2e%2e/package.json', '/..%5cpackage.json', '/assets/%2e%2e/%2e%2e/package.json']) {
      const t = await raw('GET', traversal);
      assert.equal(t.status, 404);
      assert.equal(t.body.error.code, 'NOT_FOUND');
    }
  } finally {
    await close();
  }
});

test('search (partial, case-insensitive) and status filtering', async () => {
  const { call, close } = await boot();
  try {
    const a = (await call('POST', '/api/orders', { customerName: 'Grace Hopper', items: [{ productId: 1, quantity: 1 }] })).body;
    const b = (await call('POST', '/api/orders', { customerName: 'Alan Turing', items: [{ productId: 4, quantity: 1 }] })).body;
    await call('POST', `/api/orders/${b.ref}/status`, { status: 'Packed' });

    // Partial & case-insensitive ref search
    assert.deepEqual((await call('GET', `/api/orders?search=${a.ref.toLowerCase()}`)).body.map((x) => x.ref), [a.ref]);
    assert.deepEqual((await call('GET', '/api/orders?search=000002')).body.map((x) => x.ref), [b.ref]);
    assert.deepEqual((await call('GET', '/api/orders?search=ord-000')).body.map((x) => x.ref), [b.ref, a.ref]);

    // Case-insensitive customerName search
    assert.deepEqual((await call('GET', '/api/orders?search=hopper')).body.map((x) => x.ref), [a.ref]);

    // Status filter & combined search + status
    assert.deepEqual((await call('GET', '/api/orders?status=Packed')).body.map((x) => x.ref), [b.ref]);
    assert.deepEqual((await call('GET', '/api/orders?status=Placed')).body.map((x) => x.ref), [a.ref]);
    assert.deepEqual((await call('GET', '/api/orders?search=ord&status=Packed')).body.map((x) => x.ref), [b.ref]);

    // Invalid status filter -> 400
    const badFilter = await call('GET', '/api/orders?status=Invalid');
    assert.equal(badFilter.status, 400);
    assert.equal(badFilter.body.error.code, 'INVALID_FILTER');
  } finally {
    await close();
  }
});

test('placed and cancelled orders, stock, totals, customerName, and notes survive DB restart + seed()', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-'));
  const file = path.join(dir, 't.db');
  try {
    let s = await boot(file);
    const { body: placed } = await s.call('POST', '/api/orders', {
      customerName: 'Katherine Johnson',
      notes: 'Expedite shipping',
      items: [{ productId: 2, quantity: 2 }],
    });
    const { body: cancelled } = await s.call('POST', '/api/orders', {
      customerName: 'Margaret Hamilton',
      notes: 'Cancel test',
      items: [{ productId: 1, quantity: 3 }],
    });
    assert.equal((await s.call('POST', `/api/orders/${cancelled.ref}/status`, { status: 'Cancelled' })).status, 200);
    await s.close();

    // Reopen + seed() must not overwrite live stock or orders
    s = await boot(file);
    assert.equal(await stockOf(s.call, 2), 3);
    assert.equal(await stockOf(s.call, 1), 25);

    const pDetail = (await s.call('GET', `/api/orders/${placed.ref}`)).body;
    assert.equal(pDetail.status, 'Placed');
    assert.equal(pDetail.customerName, 'Katherine Johnson');
    assert.equal(pDetail.notes, 'Expedite shipping');
    assert.equal(pDetail.subtotalCents, 2 * 8999);
    assert.equal(pDetail.taxCents, Math.round(2 * 8999 * TAX_RATE));
    assert.equal(pDetail.totalCents, pDetail.subtotalCents + pDetail.taxCents);
    assert.equal(pDetail.items[0].quantity, 2);

    const cDetail = (await s.call('GET', `/api/orders/${cancelled.ref}`)).body;
    assert.equal(cDetail.status, 'Cancelled');
    assert.equal(cDetail.customerName, 'Margaret Hamilton');
    assert.equal(cDetail.notes, 'Cancel test');
    await s.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('open() safely migrates legacy products and orders tables and backfills subtotal_cents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-mig-'));
  const file = path.join(dir, 'legacy.db');
  try {
    // Create a legacy database without brand/category/description/rating or subtotal_cents/tax_cents/customer_name/notes
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        stock INTEGER NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ref TEXT UNIQUE,
        status TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        quantity INTEGER NOT NULL
      );
      INSERT INTO products (sku, name, price_cents, stock) VALUES ('LEG-001', 'Legacy Item', 2500, 10);
      INSERT INTO orders (ref, status, total_cents, created_at, updated_at)
        VALUES ('ORD-000001', 'Placed', 5000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity)
        VALUES (1, 1, 'Legacy Item', 2500, 2);
    `);
    legacy.close();

    // Reopen through open() + boot app
    const s = await boot(file);
    const products = await s.call('GET', '/api/products');
    assert.equal(products.status, 200);
    assert.deepEqual(products.body[0], {
      id: 1,
      sku: 'LEG-001',
      name: 'Legacy Item',
      brand: '',
      category: '',
      description: '',
      rating: 4.5,
      priceCents: 2500,
      stock: 10,
    });

    const detail = await s.call('GET', '/api/orders/ORD-000001');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.subtotalCents, 5000);
    assert.equal(detail.body.taxCents, 0);
    assert.equal(detail.body.totalCents, 5000);
    assert.equal(detail.body.customerName, '');
    assert.equal(detail.body.notes, '');
    await s.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
