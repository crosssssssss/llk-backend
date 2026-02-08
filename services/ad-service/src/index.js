import http from 'node:http';
import mysql from 'mysql2/promise';
import { Kafka } from 'kafkajs';
import { env } from '../../_common/env.js';
import { readJson, json } from '../../_common/http.js';

const port = env.PORT || 3003;
const pool = mysql.createPool(env.MYSQL_DSN);
const kafka = new Kafka({ clientId: 'ad-service', brokers: (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',') });
const producer = kafka.producer();
producer.connect().catch(() => {});

const rewardByScene = {
  revive: { deltaFreeze: 1 },
  double: { deltaCoins: 50 },
  prop: { deltaHint: 1 }
};

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
    if (req.url === '/healthz') return json(res, 200, { ok: true, service: 'ad-service' });

    if (req.method === 'POST' && req.url === '/v1/ad/reward/claim') {
      const b = await readJson(req);
      const { uid, scene, adTicket } = b;
      if (!uid || !scene || !adTicket) return json(res, 400, { code: 1001, message: 'INVALID_PARAM' });
      if (!rewardByScene[scene]) return json(res, 400, { code: 3001, message: 'AD_VERIFY_FAIL' });

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        try {
          await conn.query(
            `INSERT INTO ad_reward_log(uid, scene, ad_ticket, grant_status, reward_json) VALUES(?,?,?,?,?)`,
            [uid, scene, adTicket, 'success', JSON.stringify(rewardByScene[scene])]
          );
        } catch {
          await conn.rollback();
          return json(res, 200, { code: 3002, message: 'AD_TICKET_DUPLICATE' });
        }

        const r = rewardByScene[scene];
        await conn.query(`INSERT INTO user_progress(uid) VALUES(?) ON DUPLICATE KEY UPDATE uid=uid`, [uid]);
        await conn.query(
          `UPDATE user_progress
           SET coins=coins+?, hint_count=hint_count+?, shuffle_count=shuffle_count+?, freeze_count=freeze_count+?
           WHERE uid=?`,
          [r.deltaCoins || 0, r.deltaHint || 0, r.deltaShuffle || 0, r.deltaFreeze || 0, uid]
        );

        await conn.query(
          `INSERT INTO outbox_event(aggregate_type, aggregate_id, event_type, payload)
           VALUES('ad_reward', ?, 'reward.granted', ?)`,
          [adTicket, JSON.stringify({ uid, scene, adTicket, reward: r, ts: Date.now() })]
        );

        await conn.commit();
        return json(res, 200, { code: 0, message: 'OK', data: r });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    }

    json(res, 404, { code: 1001, message: 'NOT_FOUND' });
  } catch (e) {
    json(res, 500, { code: 1005, message: 'INTERNAL_ERROR', detail: String(e.message || e) });
  }
});

server.listen(port, () => console.log('ad-service listening on', port));
