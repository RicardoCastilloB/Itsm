'use strict';

const EventEmitter = require('events');
const { QueryTypes } = require('sequelize');

function db() { return require('../config/database'); }

const TABLE = 'job_queue';
let _tableReady = false;

async function ensureTable() {
    if (_tableReady) return;
    await db().query(`
        CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
            \`id\`            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            \`queue_name\`    VARCHAR(100)    NOT NULL,
            \`data\`          JSON            NOT NULL,
            \`status\`        ENUM('waiting','active','completed','failed') DEFAULT 'waiting',
            \`attempts\`      TINYINT UNSIGNED DEFAULT 0,
            \`max_attempts\`  TINYINT UNSIGNED DEFAULT 3,
            \`result\`        JSON,
            \`error\`         TEXT,
            \`backoff_until\` DATETIME,
            \`created_at\`    DATETIME DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\`    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX \`idx_poll\` (\`queue_name\`, \`status\`, \`backoff_until\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    _tableReady = true;
}

class MysqlQueue extends EventEmitter {
    constructor(name, opts = {}) {
        super();
        this.name         = name;
        this.pollMs       = opts.pollMs || 2000;
        this._handler     = null;
        this._concurrency = 1;
        this._timer       = null;
        this._running     = 0;
        this._started     = false;
    }

    // Añade un job — misma interfaz que Bull: queue.add(data, opts)
    async add(data, opts = {}) {
        await ensureTable();
        const [result] = await db().query(
            `INSERT INTO \`${TABLE}\` (queue_name, data, max_attempts) VALUES (?, ?, ?)`,
            { replacements: [this.name, JSON.stringify(data), opts.attempts ?? 3] }
        );
        return { id: result, data };
    }

    // Registra el procesador — misma interfaz que Bull: queue.process([concurrency,] handler)
    process(concurrencyOrFn, fn) {
        if (typeof concurrencyOrFn === 'function') {
            this._handler     = concurrencyOrFn;
            this._concurrency = 1;
        } else {
            this._concurrency = concurrencyOrFn;
            this._handler     = fn;
        }
        if (!this._started) this._startPolling();
    }

    _startPolling() {
        this._started = true;
        ensureTable()
            .then(() => {
                this._timer = setInterval(() => this._tick(), this.pollMs);
            })
            .catch(err => this.emit('error', err));
    }

    async _tick() {
        if (this._running >= this._concurrency || !this._handler) return;
        await this._fetchAndProcess();
    }

    async _fetchAndProcess() {
        const seq = db();
        let job = null;
        try {
            // Reclamar un job atómicamente (single-instance: sin race conditions)
            await seq.query(`
                UPDATE \`${TABLE}\`
                SET status = 'active', attempts = attempts + 1, updated_at = NOW()
                WHERE queue_name = ?
                  AND status    = 'waiting'
                  AND (backoff_until IS NULL OR backoff_until <= NOW())
                ORDER BY id ASC
                LIMIT 1
            `, { replacements: [this.name] });

            const rows = await seq.query(`
                SELECT * FROM \`${TABLE}\`
                WHERE queue_name = ? AND status = 'active'
                ORDER BY id ASC LIMIT 1
            `, { type: QueryTypes.SELECT, replacements: [this.name] });

            if (!rows.length) return;
            job = rows[0];
            job.data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;

            this._running++;
            const result = await this._handler({ id: job.id, data: job.data });

            await seq.query(
                `UPDATE \`${TABLE}\` SET status='completed', result=?, updated_at=NOW() WHERE id=?`,
                { replacements: [JSON.stringify(result ?? null), job.id] }
            );
        } catch (err) {
            if (job) {
                const willRetry = job.attempts < job.max_attempts;
                const delayMs   = Math.min(job.attempts * 2000, 30000);
                const backoff   = willRetry
                    ? new Date(Date.now() + delayMs).toISOString().slice(0, 19).replace('T', ' ')
                    : null;
                await db().query(
                    `UPDATE \`${TABLE}\`
                     SET status=?, error=?, backoff_until=?, updated_at=NOW()
                     WHERE id=?`,
                    { replacements: [willRetry ? 'waiting' : 'failed', err.message, backoff, job.id] }
                ).catch(() => {});
                if (!willRetry) this.emit('failed', { id: job.id, data: job.data }, err);
            }
        } finally {
            if (job) this._running--;
        }
    }

    // Métricas básicas (reemplaza getJobCounts de Bull)
    async getJobCounts() {
        const rows = await db().query(`
            SELECT status, COUNT(*) AS cnt FROM \`${TABLE}\`
            WHERE queue_name = ? GROUP BY status
        `, { type: QueryTypes.SELECT, replacements: [this.name] });
        return rows.reduce((acc, r) => { acc[r.status] = Number(r.cnt); return acc; }, {
            waiting: 0, active: 0, completed: 0, failed: 0
        });
    }

    // Limpiar jobs completados/fallidos antiguos (llamar periódicamente si se quiere)
    async clean(keepDays = 7) {
        await db().query(`
            DELETE FROM \`${TABLE}\`
            WHERE queue_name = ?
              AND status IN ('completed','failed')
              AND updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        `, { replacements: [this.name, keepDays] });
    }

    close() {
        if (this._timer) clearInterval(this._timer);
        this._started = false;
    }
}

module.exports = MysqlQueue;
