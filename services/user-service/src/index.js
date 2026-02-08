import http from 'node:http';
import mysql from 'mysql2/promise';
import { env } from '../../_common/env.js';
import { readJson, json } from '../../_common/http.js';

const port = env.PORT || 3001;
const pool = mysql.createPool(env.MYSQL_DSN);

async function getOrInit(uid) {
  const [rows] = await pool.query('SELECT * FROM user_progress WHERE uid=?', [uid]);
  if (rows.length) return rows[0];
  await pool.query('INSERT INTO user_progress(uid) VALUES(?)', [uid]);
  const [rows2] = await pool.query('SELECT * FROM user_progress WHERE uid=?', [uid]);
  return rows2[0];
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') return json(res, 200, { ok: true, service: 'user-service' });

    if (req.method === 'GET' && req.url.startsWith('/v1/user/progress')) {
      const u = new URL(req.url, 'http://x');
      const uid = u.searchParams.get('uid') || req.headers['x-user-id'];
      if (!uid) return json(res, 400, { code: 1001, message: 'INVALID_PARAM' });
      const row = await getOrInit(uid);
      return json(res, 200, { code: 0, message: 'OK', data: row });
    }

    if (req.method === 'POST' && req.url === '/v1/user/assets/grant') {
      const b = await readJson(req);
      const { uid, deltaCoins = 0, deltaHint = 0, deltaShuffle = 0, deltaFreeze = 0 } = b;
      if (!uid) return json(res, 400, { code: 1001, message: 'INVALID_PARAM' });
      await getOrInit(uid);
      await pool.query(
        `UPDATE user_progress
         SET coins=coins+?, hint_count=hint_count+?, shuffle_count=shuffle_count+?, freeze_count=freeze_count+?
         WHERE uid=?`,
        [deltaCoins, deltaHint, deltaShuffle, deltaFreeze, uid]
      );
      const [rows] = await pool.query('SELECT * FROM user_progress WHERE uid=?', [uid]);
      return json(res, 200, { code: 0, message: 'OK', data: rows[0] });
    }

    json(res, 404, { code: 1001, message: 'NOT_FOUND' });
  } catch (e) {
    json(res, 500, { code: 1005, message: 'INTERNAL_ERROR', detail: String(e.message || e) });
  }
});

server.listen(port, () => console.log('user-service listening on', port));
