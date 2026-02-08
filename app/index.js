import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';

const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || 'replace_me';
const MYSQL_DSN = process.env.MYSQL_DSN;

if (!MYSQL_DSN) {
  console.error('MYSQL_DSN is required');
}

const pool = mysql.createPool(MYSQL_DSN);

async function migrate() {
  // Minimal schema for test environment (idempotent)
  await pool.query(`CREATE TABLE IF NOT EXISTS user_progress (
    uid VARCHAR(64) PRIMARY KEY,
    max_level INT NOT NULL DEFAULT 1,
    coins INT NOT NULL DEFAULT 0,
    hint_count INT NOT NULL DEFAULT 0,
    shuffle_count INT NOT NULL DEFAULT 0,
    freeze_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS level_record (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(64) NOT NULL,
    level_id INT NOT NULL,
    result ENUM('success','fail') NOT NULL,
    score INT NOT NULL DEFAULT 0,
    duration_sec INT NOT NULL DEFAULT 0,
    stars TINYINT NOT NULL DEFAULT 0,
    props_used_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_uid_level(uid, level_id),
    INDEX idx_created_at(created_at)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS iap_order (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(64) NOT NULL,
    sku VARCHAR(64) NOT NULL,
    platform_order_id VARCHAR(128) NOT NULL,
    amount_cent INT NOT NULL,
    status ENUM('created','paid','failed','refunded') NOT NULL DEFAULT 'created',
    verify_msg VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_platform_order(platform_order_id),
    INDEX idx_uid(uid)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS ad_reward_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(64) NOT NULL,
    scene ENUM('revive','double','prop') NOT NULL,
    ad_ticket VARCHAR(128) NOT NULL,
    grant_status ENUM('success','failed','duplicate') NOT NULL,
    reward_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ticket(ad_ticket),
    INDEX idx_uid_scene(uid, scene)
  )`);
}

migrate().then(() => {
  console.log('schema ok');
}).catch((e) => {
  console.error('schema migrate failed', e);
});


async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload, requestId) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': requestId });
  res.end(JSON.stringify(payload));
}

function auth(req) {
  if (req.url === '/healthz') return { ok: true, uid: 'system' };
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return { ok: false };
  try {
    const data = jwt.verify(h.slice(7), JWT_SECRET);
    return { ok: true, uid: data.uid || 'unknown' };
  } catch {
    return { ok: false };
  }
}

async function getOrInit(uid) {
  const [rows] = await pool.query('SELECT * FROM user_progress WHERE uid=?', [uid]);
  if (rows.length) return rows[0];
  await pool.query('INSERT INTO user_progress(uid) VALUES(?)', [uid]);
  const [rows2] = await pool.query('SELECT * FROM user_progress WHERE uid=?', [uid]);
  return rows2[0];
}

const sessions = new Map();

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.url === '/healthz') return send(res, 200, { ok: true, service: 'llk-backend' }, requestId);

    const a = auth(req);
    if (!a.ok) return send(res, 401, { code: 1002, message: 'UNAUTHORIZED' }, requestId);

    // Routes
    if (req.method === 'GET' && req.url.startsWith('/v1/user/progress')) {
      const u = new URL(req.url, 'http://x');
      const uid = u.searchParams.get('uid') || a.uid;
      const row = await getOrInit(uid);
      return send(res, 200, { code: 0, message: 'OK', data: row }, requestId);
    }

    if (req.method === 'POST' && req.url === '/v1/game/start') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { levelId } = b;
      if (!uid || !levelId) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const token = crypto.randomUUID();
      sessions.set(token, { uid, levelId, startedAt: Date.now() });
      return send(res, 200, { code: 0, message: 'OK', data: { sessionToken: token } }, requestId);
    }

    if (req.method === 'POST' && req.url === '/v1/game/finish') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { levelId, result, score = 0, durationSec = 0, stars = 0, propsUsed = {}, sessionToken } = b;
      if (!uid || !levelId || !result || !sessionToken) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const s = sessions.get(sessionToken);
      if (!s || s.uid !== uid || s.levelId !== levelId) return send(res, 400, { code: 2002, message: 'INVALID_SESSION' }, requestId);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          `INSERT INTO level_record(uid, level_id, result, score, duration_sec, stars, props_used_json)
           VALUES(?,?,?,?,?,?,?)`,
          [uid, levelId, result, score, durationSec, stars, JSON.stringify(propsUsed)]
        );
        let coins = 0;
        if (result === 'success') {
          coins = Math.min(80, 30 + stars * 10);
          await conn.query(
            `INSERT INTO user_progress(uid, max_level, coins)
             VALUES(?, ?, ?)
             ON DUPLICATE KEY UPDATE max_level=GREATEST(max_level, VALUES(max_level)), coins=coins+VALUES(coins)`,
            [uid, levelId, coins]
          );
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      sessions.delete(sessionToken);
      return send(res, 200, { code: 0, message: 'OK' }, requestId);
    }

    if (req.method === 'POST' && req.url === '/v1/ad/reward/claim') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { scene, adTicket } = b;
      if (!uid || !scene || !adTicket) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const rewardByScene = { revive: { deltaFreeze: 1 }, double: { deltaCoins: 50 }, prop: { deltaHint: 1 } };
      const r = rewardByScene[scene];
      if (!r) return send(res, 400, { code: 3001, message: 'AD_VERIFY_FAIL' }, requestId);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          await conn.query(
            `INSERT INTO ad_reward_log(uid, scene, ad_ticket, grant_status, reward_json) VALUES(?,?,?,?,?)`,
            [uid, scene, adTicket, 'success', JSON.stringify(r)]
          );
        } catch {
          await conn.rollback();
          return send(res, 200, { code: 3002, message: 'AD_TICKET_DUPLICATE' }, requestId);
        }
        await conn.query('INSERT INTO user_progress(uid) VALUES(?) ON DUPLICATE KEY UPDATE uid=uid', [uid]);
        await conn.query(
          `UPDATE user_progress SET coins=coins+?, hint_count=hint_count+?, shuffle_count=shuffle_count+?, freeze_count=freeze_count+? WHERE uid=?`,
          [r.deltaCoins || 0, r.deltaHint || 0, r.deltaShuffle || 0, r.deltaFreeze || 0, uid]
        );
        await conn.commit();
        return send(res, 200, { code: 0, message: 'OK', data: r }, requestId);
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    if (req.method === 'POST' && req.url === '/v1/payment/verify') {
      const b = await readJson(req);
      const uid = b.uid || a.uid;
      const { sku, platformOrderId } = b;
      if (!uid || !sku || !platformOrderId) return send(res, 400, { code: 1001, message: 'INVALID_PARAM' }, requestId);
      const skuMap = { starter_pack_6: { amountCent: 600, deltaCoins: 300, deltaHint: 3, deltaShuffle: 3, deltaFreeze: 1 } };
      const g = skuMap[sku];
      if (!g) return send(res, 400, { code: 4004, message: 'SKU_INVALID' }, requestId);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [exists] = await conn.query('SELECT * FROM iap_order WHERE platform_order_id=? FOR UPDATE', [platformOrderId]);
        if (exists.length && exists[0].status === 'paid') {
          await conn.commit();
          return send(res, 200, { code: 0, message: 'OK', data: { idempotent: true } }, requestId);
        }
        if (!exists.length) {
          await conn.query(
            `INSERT INTO iap_order(uid, sku, platform_order_id, amount_cent, status) VALUES(?,?,?,?,?)`,
            [uid, sku, platformOrderId, g.amountCent, 'created']
          );
        }
        await conn.query('UPDATE iap_order SET status=? WHERE platform_order_id=?', ['paid', platformOrderId]);
        await conn.query('INSERT INTO user_progress(uid) VALUES(?) ON DUPLICATE KEY UPDATE uid=uid', [uid]);
        await conn.query(
          `UPDATE user_progress SET coins=coins+?, hint_count=hint_count+?, shuffle_count=shuffle_count+?, freeze_count=freeze_count+? WHERE uid=?`,
          [g.deltaCoins, g.deltaHint, g.deltaShuffle, g.deltaFreeze, uid]
        );
        await conn.commit();
        return send(res, 200, { code: 0, message: 'OK', data: { paid: true } }, requestId);
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    return send(res, 404, { code: 1001, message: 'NOT_FOUND' }, requestId);
  } catch (e) {
    return send(res, 500, { code: 1005, message: 'INTERNAL_ERROR', detail: String(e.message || e) }, requestId);
  }
});

server.listen(PORT, () => console.log('llk-backend listening on', PORT));
