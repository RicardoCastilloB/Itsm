// src/queues/slaWorker.js — Worker de recálculo masivo de SLA
const { slaQueue, enqueueEmail } = require('./index');
const { Ticket, SLAPolicy }      = require('../models');
const { Op }                     = require('sequelize');
const logger                     = require('../../utils/logger');

slaQueue.process(async (job) => {
    const { ticketId } = job.data;
    const ahora = new Date();

    const where = {
        slaDueAt:  { [Op.lt]: ahora },
        slaStatus: { [Op.ne]: 'vencido' },
        status:    { [Op.notIn]: ['resuelto', 'cerrado'] },
        deletedAt: null,
    };
    if (ticketId) where.id = ticketId;

    const [vencidos] = await Ticket.update({ slaStatus: 'vencido' }, { where });

    // Marcar en riesgo
    const policies = await SLAPolicy.findAll();
    let enRiesgo = 0;
    for (const p of policies) {
        const riesgoMs  = p.tiempoResolucionH * 3600 * 1000 * 0.20;
        const umbral    = new Date(ahora.getTime() + riesgoMs);
        const w = {
            priority:  p.prioridad,
            slaDueAt:  { [Op.between]: [ahora, umbral] },
            slaStatus: 'ok',
            status:    { [Op.notIn]: ['resuelto', 'cerrado'] },
            deletedAt: null,
        };
        if (ticketId) w.id = ticketId;
        const [n] = await Ticket.update({ slaStatus: 'riesgo' }, { where: w });
        enRiesgo += n;

        // Notificar por email tickets en riesgo
        if (n > 0) {
            const riesgoTickets = await Ticket.findAll({ where: w, limit: 50 });
            for (const t of riesgoTickets) {
                if (t.assignedTo) {
                    enqueueEmail({
                        to:       t.assignedTo,
                        subject:  `⚠️ SLA en riesgo — Ticket #${t.ticketNumber}`,
                        template: 'sla-riesgo',
                        vars:     { ticket: t.toJSON() },
                    }).catch(() => {});
                }
            }
        }
    }

    if (vencidos > 0 || enRiesgo > 0) {
        logger.info(`SLA worker: ${vencidos} vencidos, ${enRiesgo} en riesgo`);
    }
    return { vencidos, enRiesgo };
});

slaQueue.on('failed', (job, err) => {
    logger.error(`❌ SLA worker fallido: ${err.message}`);
});

logger.info('✅ SLA worker activo');
module.exports = slaQueue;
