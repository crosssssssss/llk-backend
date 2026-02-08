import http from 'node:http';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { Kafka } from 'kafkajs';
import { env } from '../../_common/env.js';
import { readJson, json } from '../../_common/http.js';

const port = env.PORT || 3002;
const pool = mysql.createPool(env.MYSQL_DSN);
const sessions = new Map();

const kafka = new Kafka({ clientId: 'gameplay-service', brokers: (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',') });
const producer = kafka.producer();
producer.connect().catch(() => {});

async function relayOutboxBatch() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT * FROM outbox_event WHERE status='pending' ORDER BY id LIMIT 50 FOR UPDATE");
    for (const r of rows) {
      try {
        await producer.send({ topic: r.event_type, messages: [{ key: r.aggregate_id, value: JSON.stringify(r.payload) }] });
        await conn.query("UPDATE outbox_event SET status='sent' WHERE id=?", [r.id]);
      } catch {
        await conn.query("UPDATE outbox_event SET status='failed', retry_count=retry_count+1 WHERE id=?", [r.id]);
      }
    }
    await conn.commit();
  } catch {
    await conn.rollback();
  } finally {
    conn.release();
  }
}
setInterval(relayOutboxBatch, 2000);

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') return json(res, 200, { ok: true, service: 'gameplay-service' });

    if (req.method === 'POST' && req.url === '/v1/game/start') {
      const b = await readJson(req);
      const { uid, levelId } = b;
      if (!uid || !levelId) return json(res, 400, { code: 1001, message: 'INVALID_PARAM' });
      const token = crypto.randomUUID();
      sessions.set(token, { uid, levelId, startedAt: Date.now() });
      return json(res, 200, { code: 0, message: 'OK', data: { sessionToken: token } });
    }

    if (req.method === 'POST' && req.url === '/v1/game/finish') {
      const b = await readJson(req);
      const { uid, levelId, result, score = 0, durationSec = 0, stars = 0, propsUsed = {}, sessionToken } = b;
      if (!uid || !levelId || !result || !sessionToken) return json(res, 400, { code: 1001, message: 'INVALID_PARAM' });
      const s = sessions.get(sessionToken);
      if (!s || s.uid !== uid || s.levelId !== levelId) return json(res, 400, { code: 2002, message: 'INVALID_SESSION' });

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

        const payload = { uid, levelId, result, score, durationSec, stars, coins, ts: Date.now() };
        await conn.query(
          `INSERT INTO outbox_event(aggregate_type, aggregate_id, event_type, payload)
           VALUES('level', ?, 'level.finished', ?)`,
          [`${uid}:${levelId}:${sessionToken}`, JSON.stringify(payload)]
        );

        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }

      sessions.delete(sessionToken);
      return json(res, 200, { code: 0, message: 'OK' });
    }

    json(res, 404, { code: 1001, message: 'NOT_FOUND' });
  } catch (e) {
    json(res, 500, { code: 1005, message: 'INTERNAL_ERROR', detail: String(e.message || e) });
  }
});

server.listen(port, () => console.log('gameplay-service listening on', port));
