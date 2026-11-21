const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SEED_PRODUCTS = [
  ['WID-001', 'Logitech MX Master 3S Wireless Mouse', 'Logitech', 'Peripherals', '8K DPI sensor, quiet clicks, MagSpeed scroll wheel, USB-C', 4.7, 9999, 25],
  ['KEY-002', 'Keychron K2 Wireless Mechanical Keyboard', 'Keychron', 'Peripherals', '75% compact layout, hot-swappable tactile switches, Mac/Win', 4.6, 8999, 5],
  ['MON-003', 'LG UltraGear 27" QHD Monitor', 'LG', 'Displays', '2560x1440 IPS panel, 180Hz refresh, G-SYNC & FreeSync', 4.6, 24999, 8],
  ['USB-004', 'Anker 7-in-1 USB-C Hub', 'Anker', 'Power & Hubs', '4K HDMI, 100W PD pass-through, 2x USB-A 3.0, SD/microSD', 4.7, 2599, 40],
  ['HDP-005', 'Sony WH-1000XM5 Wireless Headphones', 'Sony', 'Audio', 'Industry-leading ANC, 30-hr battery, multipoint Bluetooth', 4.6, 34999, 0],
  ['CAM-006', 'Logitech C920x HD Pro Webcam', 'Logitech', 'Creator', 'Full HD 1080p/30fps glass lens, dual stereo mics, privacy shutter', 4.6, 6499, 3],
  ['SSD-007', 'Samsung T7 Shield 1TB Portable SSD', 'Samsung', 'Storage', 'USB 3.2 Gen 2 up to 1,050 MB/s, IP65 water & drop resistant', 4.8, 9999, 18],
  ['EAR-008', 'Apple AirPods Pro (2nd Gen)', 'Apple', 'Audio', 'Active Noise Cancellation, Adaptive Audio, USB-C MagSafe case', 4.7, 24900, 12],
  ['SPK-009', 'Bose SoundLink Flex (2nd Gen) Speaker', 'Bose', 'Audio', 'IP67 waterproof portable Bluetooth 5.3, PositionIQ, 12-hr battery', 4.8, 14900, 9],
  ['CRD-010', 'Elgato Stream Deck MK.2', 'Elgato', 'Creator', '15 customizable LCD macro keys, detachable stand, USB-C', 4.8, 14999, 4],
  ['PWR-011', 'Anker Prime 20,000mAh Power Bank', 'Anker', 'Power & Hubs', '200W total output, dual USB-C fast charging, smart digital display', 4.7, 10999, 15],
  ['KDL-012', 'Amazon Kindle Paperwhite (7")', 'Amazon', 'Reading', 'Glare-free 7" display, adjustable warm light, waterproof, 12-wk battery', 4.7, 15999, 0],
];

function defaultDbPath() {
  if (process.env.DB_FILE) return process.env.DB_FILE;
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'commerce-orders.db');
  return path.join(__dirname, '..', 'data', 'orders.db');
}

function open(file = defaultDbPath()) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      rating REAL NOT NULL DEFAULT 4.5,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('Placed','Packed','Shipped','Cancelled')),
      subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
      tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      customer_name TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  `);

  // Safe, idempotent migrations for pre-existing databases.
  const productCols = new Set(db.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
  const productMigrations = [
    ['brand', "ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT ''"],
    ['category', "ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT ''"],
    ['description', "ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT ''"],
    ['rating', 'ALTER TABLE products ADD COLUMN rating REAL NOT NULL DEFAULT 4.5'],
  ];
  for (const [col, sql] of productMigrations) {
    if (!productCols.has(col)) db.exec(sql);
  }

  const orderCols = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
  const orderMigrations = [
    ['subtotal_cents', 'ALTER TABLE orders ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0'],
    ['tax_cents', 'ALTER TABLE orders ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0'],
    ['customer_name', "ALTER TABLE orders ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''"],
    ['notes', "ALTER TABLE orders ADD COLUMN notes TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, sql] of orderMigrations) {
    if (!orderCols.has(col)) db.exec(sql);
  }
  db.exec('UPDATE orders SET subtotal_cents = total_cents WHERE subtotal_cents = 0 AND total_cents > 0');

  return db;
}

/** Insert the catalogue only if it is empty (never overwrites live stock). */
function seed(db, { reset = false } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (reset) {
      db.exec('DELETE FROM order_items; DELETE FROM orders; DELETE FROM products;');
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('order_items','orders','products')");
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
    if (n > 0) {
      db.exec('COMMIT');
      return false;
    }
    const ins = db.prepare(
      'INSERT INTO products (sku,name,brand,category,description,rating,price_cents,stock) VALUES (?,?,?,?,?,?,?,?)',
    );
    for (const p of SEED_PRODUCTS) ins.run(...p);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore if already rolled back */ }
    throw err;
  }
}

module.exports = { open, seed, SEED_PRODUCTS };
