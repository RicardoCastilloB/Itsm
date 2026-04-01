// ============================================================================
// src/jobs/weeklyReport.js — Job semanal (lunes 8am): resumen a supervisores
// Item 126
// ============================================================================

const cron = require('node-cron');
const sequelize = require('../config/database');
const { User } = require('../models');
const { enqueueEmail } = require('../queues/index');
const logger = require('../../utils/logger');

// Lunes a las 8am
cron.schedule('0 8 * * 1', async () => {
    logger.info('[weeklyReport] Generando reporte semanal...');
    try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [stats] = await sequelize.query(`
            SELECT
              COUNT(*)                                                          AS total,
              SUM(CASE WHEN status = 'resuelto' THEN 1 ELSE 0 END)             AS resueltos,
              SUM(CASE WHEN sla_status = 'vencido' THEN 1 ELSE 0 END)          AS vencidos,
              SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END)                 AS p1,
              SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END)                 AS p2,
              ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN
                TIMESTAMPDIFF(MINUTE, created_at, resolved_at) / 60.0 END), 1) AS avg_h,
              ROUND(SUM(CASE WHEN sla_status = 'ok' AND status = 'resuelto' THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status = 'resuelto' THEN 1 ELSE 0 END), 0) * 100, 1) AS sla_pct
            FROM tickets
            WHERE created_at >= :weekAgo AND deleted_at IS NULL
        `, { replacements: { weekAgo } });

        const s = stats[0] || {};

        // Top 5 categorías
        const [topCats] = await sequelize.query(`
            SELECT c.nombre, COUNT(t.id) AS cnt
            FROM tickets t
            JOIN itsm_categories c ON t.category_id = c.id
            WHERE t.created_at >= :weekAgo AND t.deleted_at IS NULL
            GROUP BY c.nombre ORDER BY cnt DESC LIMIT 5
        `, { replacements: { weekAgo } });

        // Carga por agente
        const [agentLoad] = await sequelize.query(`
            SELECT u.full_name AS nombre, COUNT(t.id) AS total,
              SUM(CASE WHEN t.status = 'resuelto' THEN 1 ELSE 0 END) AS resueltos
            FROM tickets t
            JOIN users u ON t.assigned_to = u.id
            WHERE t.created_at >= :weekAgo AND t.deleted_at IS NULL
            GROUP BY u.id, u.full_name ORDER BY total DESC LIMIT 10
        `, { replacements: { weekAgo } });

        const supervisors = await User.findAll({ where: { rol: { [require('sequelize').Op.in]: ['supervisor', 'admin'] }, activo: true } });
        for (const sup of supervisors) {
            await enqueueEmail({
                to:       sup.email,
                subject:  `📊 Reporte semanal ITSM — ${new Date().toLocaleDateString('es',{day:'numeric',month:'long'})}`,
                template: 'ticket-creado', // reusing base template
                vars:     {
                    nombre: sup.nombre,
                    titulo: 'Resumen Semanal',
                    descripcion: `
Período: últimos 7 días

📋 RESUMEN GENERAL
  Total tickets creados: ${s.total || 0}
  Resueltos:  ${s.resueltos || 0}
  SLA vencidos: ${s.vencidos || 0}
  P1 críticos: ${s.p1 || 0} | P2 altos: ${s.p2 || 0}
  Tiempo promedio resolución: ${s.avg_h || '—'} horas
  Cumplimiento SLA: ${s.sla_pct || '—'}%

📁 TOP CATEGORÍAS
${topCats.map((c,i) => `  ${i+1}. ${c.nombre}: ${c.cnt} tickets`).join('\n')}

👥 CARGA POR AGENTE
${agentLoad.map(a => `  ${a.nombre}: ${a.total} total, ${a.resueltos} resueltos`).join('\n')}
                    `.trim(),
                },
            });
        }

        logger.info(`[weeklyReport] Reporte enviado a ${supervisors.length} supervisores`);
    } catch (err) {
        logger.error('[weeklyReport] Error:', err.message);
    }
}, { timezone: 'America/Lima' });

logger.info('[weeklyReport] Job registrado — lunes 8am');
