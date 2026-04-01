// src/queues/index.js — Colas Bull centralizadas
const Bull = require('bull');
const { redisConfig } = require('../config/redis');

const opts = { redis: redisConfig };

const emailQueue   = new Bull('email',   opts);
const slaQueue     = new Bull('sla',     opts);
const reportsQueue = new Bull('reports', opts);

// ── Opciones de reintento por defecto ────────────────────────────
const defaultJobOptions = {
    attempts:  3,
    backoff:   { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,   // conservar últimos 50 jobs completados
    removeOnFail:     100,
};

/**
 * Encolar un email
 * @param {Object} data  { to, subject, template, vars }
 */
function enqueueEmail(data) {
    return emailQueue.add(data, defaultJobOptions);
}

/**
 * Encolar recálculo de SLA
 * @param {string|null} ticketId  null = recalcular todos
 */
function enqueueSla(ticketId = null) {
    return slaQueue.add({ ticketId }, { ...defaultJobOptions, attempts: 5 });
}

/**
 * Encolar generación de reporte
 * @param {Object} data  { type: 'pdf'|'csv'|'excel', filters, userId }
 */
function enqueueReport(data) {
    return reportsQueue.add(data, { ...defaultJobOptions, timeout: 120_000 });
}

module.exports = { emailQueue, slaQueue, reportsQueue, enqueueEmail, enqueueSla, enqueueReport };
