const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { open, seed } = require('./db');
const { createService, ApiError } = require('./service');

const PUBLIC = path.resolve(__dirname, '..', 'public');
const PUBLIC_PREFIX = PUBLIC.endsWith(path.sep) ? PUBLIC : PUBLIC + path.sep;
const ASSETS_PREFIX = path.join(PUBLIC, 'assets') + path.sep;
const MAX_BODY_BYTES = 100_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(data);
}

function methodNotAllowed(method, allowed) {
  return new ApiError(
    405,
    'METHOD_NOT_ALLOWED',
    `Method ${method} not allowed`,
    undefined,
    { Allow: allowed.join(', ') },
  );
}

function safeDecode(segment) {
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded.includes('\0')) {
      throw new ApiError(400, 'BAD_URL', 'Invalid null byte in URL');
    }
    return decoded;
  } catch (err) {
    if (err instanceof URIError) {
      throw new ApiError(400, 'BAD_URL', 'Malformed percent-encoding in URL');
    }
    throw err;
  }
}

function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (!req.body.trim()) return Promise.resolve({});
      try {
        return Promise.resolve(JSON.parse(req.body));
      } catch {
        return Promise.reject(new ApiError(400, 'BAD_JSON', 'Request body is not valid JSON'));
      }
    }
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        fail(new ApiError(413, 'TOO_LARGE', 'Body too large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'BAD_JSON', 'Request body is not valid JSON'));
      }
    });
    req.on('error', fail);
  });
}

function createHandler(db) {
  const svc = createService(db);

  return async (req, res) => {
    try {
      let url;
      try {
        url = new URL(req.url || '/', 'http://localhost');
      } catch {
        throw new ApiError(400, 'BAD_URL', 'Malformed request URL');
      }
      const p = url.pathname;

      if (p === '/api' || p.startsWith('/api/')) {
        let m;
        if (p === '/api/health') {
          if (req.method !== 'GET') throw methodNotAllowed(req.method, ['GET']);
          return send(res, 200, svc.health());
        }
        if (p === '/api/products') {
          if (req.method !== 'GET') throw methodNotAllowed(req.method, ['GET']);
          return send(res, 200, svc.listProducts());
        }
        if (p === '/api/orders') {
          if (req.method === 'GET') {
            return send(res, 200, svc.listOrders({
              search: url.searchParams.get('search') || '',
              status: url.searchParams.get('status') || '',
            }));
          }
          if (req.method === 'POST') {
            return send(res, 201, svc.createOrder(await readJson(req)));
          }
          throw methodNotAllowed(req.method, ['GET', 'POST']);
        }
        if ((m = p.match(/^\/api\/orders\/([^/]+)$/))) {
          if (req.method !== 'GET') throw methodNotAllowed(req.method, ['GET']);
          return send(res, 200, svc.getOrder(safeDecode(m[1])));
        }
        if ((m = p.match(/^\/api\/orders\/([^/]+)\/status$/))) {
          if (req.method !== 'POST') throw methodNotAllowed(req.method, ['POST']);
          const ref = safeDecode(m[1]);
          const body = await readJson(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new ApiError(400, 'VALIDATION', 'Request body must be a JSON object');
          }
          return send(res, 200, svc.changeStatus(ref, body.status));
        }
        throw new ApiError(404, 'NOT_FOUND', 'No such endpoint');
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw methodNotAllowed(req.method, ['GET', 'HEAD']);
      }
      const decodedPath = safeDecode(p);
      const rel = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
      const full = path.resolve(PUBLIC, rel);
      if (!full.startsWith(PUBLIC_PREFIX)) {
        throw new ApiError(404, 'NOT_FOUND', 'Not found');
      }
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        throw new ApiError(404, 'NOT_FOUND', 'Not found');
      }
      if (!stat.isFile()) {
        throw new ApiError(404, 'NOT_FOUND', 'Not found');
      }
      const cacheControl = full.startsWith(ASSETS_PREFIX)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': cacheControl,
      });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(full);
      stream.on('error', () => {
        if (!res.headersSent) send(res, 500, { error: { code: 'INTERNAL', message: 'Internal server error' } });
        else res.end();
      });
      stream.pipe(res);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof ApiError) {
        return send(res, e.status, { error: { code: e.code, message: e.message, details: e.details } }, e.headers);
      }
      console.error(e);
      send(res, 500, { error: { code: 'INTERNAL', message: 'Internal server error' } });
    }
  };
}

function createApp(db) {
  return http.createServer(createHandler(db));
}

if (require.main === module) {
  const db = open();
  if (seed(db)) console.log('Seeded empty catalogue.');
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => console.log(`Order console running at http://localhost:${port}`));
}

module.exports = { createApp, createHandler };
