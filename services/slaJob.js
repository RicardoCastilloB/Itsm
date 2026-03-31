// ============================================================================
// services/slaJob.js — Job que revisa SLA cada 5 minutos
//
// Lógica:
//   - ok      → sla_due_at > ahora + 20% del tiempo restante
//   - riesgo  → sla_due_at entre ahora y ahora + 20% del tiempo
//   - vencido → sla_due_at < ahora
//
// Se registra en server.js con: require('./services/slaJob')
// ============================================================================

const cron   = require('node-cron');
const { Op } = require('sequelize');
const { Ticket, SLAPolicy } = require('../src/models');
const logger = require('../utils/logger');

// Umbrales de riesgo por prioridad (% del tiempo total de resolución)
const RIESGO_PCT = 0.20; // último 20% del tiempo = "en riesgo"

async function checkSLA() {
    try {
        const ahora = new Date();

        // ── Marcar VENCIDOS ────────────────────────────────────────────────
        const vencidos = await Ticket.update(
            { slaStatus: 'vencido' },
            {
                where: {
                    slaDueAt:  { [Op.lt]: ahora },
                    slaStatus: { [Op.ne]: 'vencido' },
                    status:    { [Op.notIn]: ['resuelto', 'cerrado'] },
                    deletedAt: null,
                },
            }
        );

        // ── Marcar EN RIESGO (dentro del último 20%) ───────────────────────
        // Para cada prioridad calculamos el umbral de riesgo
        const policies = await SLAPolicy.findAll();

        let enRiesgoCount = 0;
        for (const policy of policies) {
            const windowMs   = policy.tiempoResolucionH * 60 * 60 * 1000;
            const riesgoMs   = windowMs * RIESGO_PCT;
            const umbral     = new Date(ahora.getTime() + riesgoMs);

            const [n] = await Ticket.update(
                { slaStatus: 'riesgo' },
                {
                    where: {
                        priority:  policy.prioridad,
                        slaDueAt:  { [Op.between]: [ahora, umbral] },
                        slaStatus: 'ok',
                        status:    { [Op.notIn]: ['resuelto', 'cerrado'] },
                        deletedAt: null,
                    },
                }
            );
            enRiesgoCount += n;
        }

        // ── Restaurar a OK tickets resueltos/cerrados ──────────────────────
        await Ticket.update(
            { slaStatus: 'ok' },
            {
                where: {
                    status:    { [Op.in]: ['resuelto', 'cerrado'] },
                    slaStatus: { [Op.ne]: 'ok' },
                },
            }
        );

        if (vencidos[0] > 0 || enRiesgoCount > 0) {
            logger.info(`SLA job: ${vencidos[0]} vencidos, ${enRiesgoCount} en riesgo`);
        }

    } catch (error) {
        logger.error('Error en SLA job:', error.message);
    }
}

// Ejecutar cada 5 minutos
cron.schedule('*/5 * * * *', checkSLA);

// Ejecutar una vez al arrancar
checkSLA();

logger.info('✅ SLA job iniciado (cada 5 minutos)');

module.exports = { checkSLA };
