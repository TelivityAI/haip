/**
 * Mock DerbySoft Property Connector API
 *
 * REST/JSON with OAuth Bearer tokens. Mirrors PC Integration API paths used by
 * HAIP's DerbySoft adapter for local development and tests.
 *
 * Usage:
 *   node server.mjs              # starts on port 4002
 *   PORT=4003 node server.mjs    # custom port
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = parseInt(process.env.PORT ?? '4002', 10);
const CLIENT_ID = process.env.CLIENT_ID ?? 'haip_test';
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? 'test_password';

const store = {
  tokens: new Set(),
  rates: [],
  inventories: [],
  availabilities: [],
  hotels: [],
  roomTypes: [],
  resStatuses: [],
  requests: [],
};

// Simple 15 req/s limiter (mirrors vendor)
let tokens = 15;
let lastRefill = Date.now();
function allowRequest() {
  const now = Date.now();
  if (now - lastRefill >= 1000) {
    tokens = 15;
    lastRefill = now;
  }
  if (tokens <= 0) return false;
  tokens -= 1;
  return true;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json;charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function verifyBasic(req) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Basic ')) return false;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  return decoded.slice(0, idx) === CLIENT_ID && decoded.slice(idx + 1) === CLIENT_SECRET;
}

function verifyBearer(req) {
  const auth = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return false;
  return store.tokens.has(m[1].trim());
}

function echoHeader(body) {
  const h = body?.header ?? {};
  return {
    echoToken: h.echoToken ?? 'mock-echo',
    timeStamp: new Date().toISOString(),
    version: h.version ?? '0.1',
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { status: 'ok', service: 'mock-derbysoft' });
  }
  if (req.method === 'GET' && path === '/store') {
    return json(res, 200, {
      rates: store.rates.length,
      inventories: store.inventories.length,
      availabilities: store.availabilities.length,
      hotels: store.hotels.length,
      roomTypes: store.roomTypes.length,
      resStatuses: store.resStatuses.length,
      tokens: store.tokens.size,
    });
  }
  if (req.method === 'POST' && path === '/reset') {
    store.tokens.clear();
    store.rates = [];
    store.inventories = [];
    store.availabilities = [];
    store.hotels = [];
    store.roomTypes = [];
    store.resStatuses = [];
    store.requests = [];
    return json(res, 200, { reset: true });
  }

  if (!allowRequest()) {
    return json(res, 429, {
      header: { echoToken: 'rate-limit', timeStamp: new Date().toISOString(), version: '0.1' },
      errorCode: 'TooManyRequests',
      errorMessage: 'rate limit is 15 requests per second',
    });
  }

  let body = {};
  try {
    if (req.method === 'POST' || req.method === 'PUT') body = await readBody(req);
  } catch {
    return json(res, 500, {
      header: echoHeader({}),
      errorCode: 'InvalidField',
      errorMessage: 'Invalid JSON',
    });
  }

  store.requests.push({ method: req.method, path, at: new Date().toISOString() });

  // Token
  if (req.method === 'POST' && path === '/pcapigateway/account/token') {
    if (!verifyBasic(req)) {
      return json(res, 401, {
        header: echoHeader(body),
        errorCode: 'Unauthorized',
        errorMessage: 'Invalid client credentials',
      });
    }
    const accessToken = randomBytes(24).toString('hex');
    store.tokens.clear(); // new token invalidates old ones (vendor behavior)
    store.tokens.add(accessToken);
    return json(res, 200, { accessToken, tokenType: 'Bearer' });
  }

  // All other PC endpoints require Bearer
  if (!verifyBearer(req)) {
    return json(res, 401, {
      header: echoHeader(body),
      errorCode: 'Unauthorized',
      errorMessage: 'Invalid token',
    });
  }

  // Tunnel ARI
  const tunnelMatch = path.match(/^\/pcapigateway\/tunnel\/[^/]+\/(rate|inventory|availability|resStatus)$/);
  if (req.method === 'POST' && tunnelMatch) {
    const kind = tunnelMatch[1];
    if (kind === 'rate') store.rates.push(body);
    else if (kind === 'inventory') store.inventories.push(body);
    else if (kind === 'availability') store.availabilities.push(body);
    else store.resStatuses.push(body);
    return json(res, 200, { header: echoHeader(body) });
  }

  // Profile
  const profileMatch = path.match(/^\/pcapigateway\/profile\/[^/]+\/(hotel|roomtype|rateplan|product)$/);
  if (req.method === 'POST' && profileMatch) {
    const kind = profileMatch[1];
    if (kind === 'hotel') store.hotels.push(body);
    else if (kind === 'roomtype') store.roomTypes.push(body);
    return json(res, 200, { header: echoHeader(body) });
  }

  return json(res, 404, {
    header: echoHeader(body),
    errorCode: 'NotFound',
    errorMessage: `No mock handler for ${req.method} ${path}`,
  });
});

server.listen(PORT, () => {
  console.log(`mock-derbysoft listening on :${PORT}`);
});
