import http from 'node:http';
import mysql from 'mysql2/promise';
import { Kafka } from 'kafkajs';
import { env } from '../../_common/env.js';
import { readJson, json } from '../../_common/http.js';

const port = env.PORT || 3004;
const pool = mysql.createPool(env.MYSQL_DSN);
const kafka = new Kafka({ clientId: 'payment-service', brokers: (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',') });
const producer = kafka.producer();
producer.connect().catch(() => {});

const skuMap = {
  starter_pack_6: { amountCent: 600, deltaCoins: 300, deltaHint: 3, deltaShuffle: 3, deltaFreeze: 1 }
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
    if (req.url === '/healthz') return json(res, 200, { ok: true, service: 'payment-service' });

    if (req.method === 'POST' && req.url === '/v1/payment/verify') {
      const b = await readJson(req);
      const { uid, sku, platformOrderId } = b;
      if (!uid || !sku || !platformOrderId) return json(res, 400, { code: 1001, message: 'INVALID_PARAM' });
      if (!skuMap[sku]) return json(res, 400, { code: 4004, message: 'SKU_INVALID' });

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [exists] = await conn.query('SELECT * FROM iap_order WHERE platform_order_id=? FOR UPDATE', [platformOrderId]);
        if (exists.length && exists[0].status === 'paid') {
          await conn.commit();
          return json(res, 200, { code: 0, message: 'OK', data: { idempotent: true } });
        }

        if (!exists.length) {
          await conn.query(
            `INSERT INTO iap_order(uid, sku, platform_order_id, amount_cent, status) VALUES(?,?,?,?,?)`,
            [uid, sku, platformOrderId, skuMap[sku].amountCent, 'created']
          );
        }

        // mock verify success
        await conn.query('UPDATE iap_order SET status=? WHERE platform_order_id=?', ['paid', platformOrderId]);

        const g = skuMap[sku];
        await conn.query('INSERT INTO user_progress(uid) VALUES(?) ON DUPLICATE KEY UPDATE uid=uid', [uid]);
        await conn.query(
          `UPDATE user_progress
           SET coins=coins+?, hint_count=hint_count+?, shuffle_count=shuffle_count+?, freeze_count=freeze_count+?
           WHERE uid=?`,
          [g.deltaCoins, g.deltaHint, g.deltaShuffle, g.deltaFreeze, uid]
        );

        await conn.query(
          `INSERT INTO outbox_event(aggregate_type, aggregate_id, event_type, payload)
           VALUES('order', ?, 'order.paid', ?)`,
          [platformOrderId, JSON.stringify({ uid, sku, platformOrderId, amountCent: g.amountCent, ts: Date.now() })]
        );

        await conn.commit();
        return json(res, 200, { code: 0, message: 'OK', data: { paid: true } });
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

server.listen(port, () => console.log('payment-service listening on', port));
