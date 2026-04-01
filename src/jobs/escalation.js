// ============================================================================
// src/jobs/escalation.js — Job cada hora: escalar tickets P1/P2 inactivos
// Item 124
// ============================================================================

const cron = require('node-cron');
const { Op } = require('sequelize');
const { Ticket, TicketComment, User } = require('../models');
const { enqueueEmail } = require('../queues/index');
const logger = require('../../utils/logger');

const ESCALATION_THRESHOLDS = {
    P1: 1 * 60,   // 1 hora sin actividad
    P2: 4 * 60,   // 4 horas sin actividad
};

cron.schedule('0 * * * *', async () => {
    logger.info('[escalation] Revisando tickets P1/P2 sin actividad...');
    try {
        const now = new Date();

        for (const [priority, thresholdMin] of Object.entries(ESCALATION_THRESHOLDS)) {
            const tickets = await Ticket.findAll({
                where: {
                    priority,
                    status:    { [Op.in]: ['abierto', 'en_progreso'] },
                    deletedAt: null,
                },
            });

            for (const ticket of tickets) {
                // Buscar último comentario
                const lastComment = await TicketComment.findOne({
                    where:  { ticketId: ticket.id },
                    order:  [['createdAt', 'DESC']],
                });
                const lastActivity = lastComment ? new Date(lastComment.createdAt) : new Date(ticket.createdAt);
                const inactiveMin  = Math.round((now - lastActivity) / 60000);

                if (inactiveMin >= thresholdMin) {
                    // Registrar escalado en historial
                    await TicketComment.create({
                        ticketId:  ticket.id,
                        userId:    null,
                        contenido: `[Auto-escalado] Ticket ${priority} sin actividad por ${inactiveMin} minutos. Escalado a supervisores.`,
                        tipo:      'sistema',
                        metadata:  { escalated: true, inactiveMin, threshold: thresholdMin },
                    });

                    // Notificar supervisores
                    const supervisors = await User.findAll({ where: { rol: 'supervisor', activo: true } });
                    for (const sup of supervisors) {
                        await enqueueEmail({
                            to:       sup.email,
                            subject:  `🚨 Escalado automático ${priority}: ${ticket.titulo}`,
                            template: 'sla-riesgo',
                            vars:     { nombre: sup.nombre, ticketId: ticket.id, titulo: ticket.titulo, inactiveMin, priority },
                        });
                    }

                    logger.warn(`[escalation] Ticket ${ticket.id} (${priority}) escalado — ${inactiveMin}min inactivo`);
                }
            }
        }
    } catch (err) {
        logger.error('[escalation] Error:', err.message);
    }
}, { timezone: 'America/Lima' });

logger.info('[escalation] Job registrado — cada hora');
