import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { env } from '../../_common/env.js';
import { readJson, json, fetchWithTimeout } from '../../_common/http.js';

const port = env.PORT || 8080;
const redis = new Redis(env.REDIS_URL, { lazyConnect: true });

const routes = [
  { prefix: '/api/user', target: process.env.USER_SVC_URL || 'http://127.0.0.1:3001' },
  { prefix: '/api/gameplay', target: process.env.GAMEPLAY_SVC_URL || 'http://127.0.0.1:3002' },
  { prefix: '/api/ad', target: process.env.AD_SVC_URL || 'http://127.0.0.1:3003' },
  { prefix: '/api/payment', target: process.env.PAYMENT_SVC_URL || 'http://127.0.0.1:3004' }
];

const breaker = new Map(); // key -> { fail, openUntil }

function breakerKey(route) { return route.prefix; }
function canPass(route) {
  const s = breaker.get(breakerKey(route));
  if (!s) return true;
  if (s.openUntil && Date.now() < s.openUntil) return false;
  return true;
}
function onSuccess(route) { breaker.set(breakerKey(route), { fail: 0, openUntil: 0 }); }
function onFail(route) {
  const k = breakerKey(route);
  const s = breaker.get(k) || { fail: 0, openUntil: 0 };
  s.fail += 1;
  if (s.fail >= 5) s.openUntil = Date.now() + 15000;
  breaker.set(k, s);
}

async function rateLimit(ip) {
  const k = `llk:gw:rl:${ip}`;
  const c = await redis.incr(k);
  if (c === 1) await redis.expire(k, 1);
  return c > 80;
}

function auth(req) {
  if (req.url === '/healthz') return { ok: true, uid: 'system' };
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return { ok: false, code: 1002, message: 'UNAUTHORIZED' };
  try {
    const data = jwt.verify(h.slice(7), env.JWT_SECRET);
    return { ok: true, uid: data.uid || 'unknown' };
  } catch {
    return { ok: false, code: 1002, message: 'UNAUTHORIZED' };
  }
}

function pickRoute(url = '') { return routes.find((r) => url.startsWith(r.prefix)); }

async function proxy(req, route, requestId, uid) {
  const downstreamPath = req.url.replace(route.prefix, '') || '/';
  const u = `${route.target}${downstreamPath}`;
  const method = req.method || 'GET';
  const bodyObj = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJson(req).catch(() => ({})) : undefined;

  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetchWithTimeout(u, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
          'x-user-id': uid
        },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined
      }, 1500 + i * 500);
      onSuccess(route);
      return r;
    } catch (e) {
      lastErr = e;
      onFail(route);
    }
  }
  throw lastErr || new Error('DOWNSTREAM_UNAVAILABLE');
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  const ip = req.socket.remoteAddress || 'unknown';

  if (req.url === '/healthz') return json(res, 200, { ok: true, service: 'gateway' }, { 'x-request-id': requestId });

  try {
    if (await rateLimit(ip)) return json(res, 429, { code: 1004, message: 'TOO_MANY_REQUESTS' }, { 'x-request-id': requestId });
    const a = auth(req);
    if (!a.ok) return json(res, 401, { code: a.code, message: a.message }, { 'x-request-id': requestId });

    const route = pickRoute(req.url);
    if (!route) return json(res, 404, { code: 1001, message: 'ROUTE_NOT_FOUND' }, { 'x-request-id': requestId });
    if (!canPass(route)) return json(res, 503, { code: 1005, message: 'CIRCUIT_OPEN' }, { 'x-request-id': requestId });

    const r = await proxy(req, route, requestId, a.uid);
    const txt = await r.text();
    res.writeHead(r.status, { 'content-type': 'application/json', 'x-request-id': requestId });
    res.end(txt);
  } catch (e) {
    json(res, 503, { code: 1005, message: 'DOWNSTREAM_UNAVAILABLE', detail: String(e.message || e) }, { 'x-request-id': requestId });
  }
});

redis.connect().catch(() => {});
server.listen(port, () => console.log('gateway listening on', port));
