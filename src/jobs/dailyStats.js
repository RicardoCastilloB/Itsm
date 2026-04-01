// ============================================================================
// src/jobs/dailyStats.js — Job diario a medianoche: generar métricas del día
// Item 125
// ============================================================================

const cron = require('node-cron');
const { Op, literal, fn, col } = require('sequelize');
const sequelize = require('../config/database');
const { Ticket } = require('../models');
const logger = require('../../utils/logger');

// Medianoche cada día
cron.schedule('0 0 * * *', async () => {
    logger.info('[dailyStats] Generando métricas del día...');
    try {
        await generateDailyStats(new Date());
        logger.info('[dailyStats] Métricas generadas correctamente');
    } catch (err) {
        logger.error('[dailyStats] Error:', err.message);
    }
}, { timezone: 'America/Lima' });

async function generateDailyStats(forDate) {
    // Calcular fecha de ayer
    const d = new Date(forDate);
    d.setHours(0, 0, 0, 0);
    const dayStart = new Date(d);
    const dayEnd   = new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1);
    const statDate = d.toISOString().slice(0, 10);

    const [created, resolved, breached] = await Promise.all([
        Ticket.count({ where: { createdAt: { [Op.between]: [dayStart, dayEnd] }, deletedAt: null } }),
        Ticket.count({ where: { resolvedAt: { [Op.between]: [dayStart, dayEnd] }, deletedAt: null } }),
        Ticket.count({ where: { slaStatus: 'vencido', createdAt: { [Op.lte]: dayEnd }, deletedAt: null } }),
    ]);

    // Avg resolution time (hours) for tickets resolved that day
    const [avgRows] = await sequelize.query(`
        SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) / 60.0 AS avg_h
        FROM tickets
        WHERE resolved_at BETWEEN :start AND :end AND deleted_at IS NULL AND resolved_at IS NOT NULL
    `, { replacements: { start: dayStart, end: dayEnd } });
    const avgH = avgRows[0]?.avg_h ? parseFloat(avgRows[0].avg_h).toFixed(2) : null;

    // SLA compliance (resolved tickets within SLA)
    const [slaRows] = await sequelize.query(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN sla_status = 'ok' THEN 1 ELSE 0 END) as within_sla
        FROM tickets
        WHERE resolved_at BETWEEN :start AND :end AND deleted_at IS NULL
    `, { replacements: { start: dayStart, end: dayEnd } });
    const total    = slaRows[0]?.total || 0;
    const withinSla = slaRows[0]?.within_sla || 0;
    const slaPct   = total > 0 ? parseFloat((withinSla / total * 100).toFixed(2)) : null;

    // Priority counts (open at midnight)
    const [prioRows] = await sequelize.query(`
        SELECT priority, COUNT(*) as cnt FROM tickets
        WHERE status NOT IN ('resuelto','cerrado') AND deleted_at IS NULL
        GROUP BY priority
    `);
    const prioCounts = {};
    prioRows.forEach(r => { prioCounts[r.priority] = parseInt(r.cnt); });

    // Tickets abiertos al final del día
    const openAtMidnight = await Ticket.count({ where: { status: { [Op.notIn]: ['resuelto','cerrado'] }, deletedAt: null } });

    await sequelize.query(`
        INSERT INTO daily_stats (stat_date, tickets_created, tickets_resolved, tickets_breached,
          avg_resolution_h, sla_compliance_pct, p1_count, p2_count, p3_count, p4_count, open_at_midnight)
        VALUES (:statDate, :created, :resolved, :breached, :avgH, :slaPct,
          :p1, :p2, :p3, :p4, :openAtMidnight)
        ON DUPLICATE KEY UPDATE
          tickets_created = VALUES(tickets_created),
          tickets_resolved = VALUES(tickets_resolved),
          tickets_breached = VALUES(tickets_breached),
          avg_resolution_h = VALUES(avg_resolution_h),
          sla_compliance_pct = VALUES(sla_compliance_pct),
          p1_count = VALUES(p1_count), p2_count = VALUES(p2_count),
          p3_count = VALUES(p3_count), p4_count = VALUES(p4_count),
          open_at_midnight = VALUES(open_at_midnight)
    `, {
        replacements: {
            statDate, created, resolved, breached, avgH, slaPct,
            p1: prioCounts['P1'] || 0, p2: prioCounts['P2'] || 0,
            p3: prioCounts['P3'] || 0, p4: prioCounts['P4'] || 0,
            openAtMidnight,
        },
    });

    return { statDate, created, resolved, breached, avgH, slaPct };
}

module.exports = { generateDailyStats };
logger.info('[dailyStats] Job registrado — medianoche');
