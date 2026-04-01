// ============================================================================
// src/jobs/slaMonitor.js — Job cada 5 minutos: revisar SLA
// Item 123: tickets próximos a vencer → alert al agente
// ============================================================================

const cron = require('node-cron');
const { Op } = require('sequelize');
const { Ticket, User, SLAPolicy } = require('../models');
const { enqueueEmail } = require('../queues/index');
const { evalTicket }   = require('../rules/engine');
const logger = require('../../utils/logger');

// Cada 5 minutos
cron.schedule('*/5 * * * *', async () => {
    logger.info('[slaMonitor] Ejecutando revisión SLA...');
    try {
        const now = new Date();
        const tickets = await Ticket.findAll({
            where: {
                status:   { [Op.notIn]: ['resuelto', 'cerrado'] },
                slaDueAt: { [Op.not]: null },
                deletedAt: null,
            },
            include: [{ model: User, as: 'agente', foreignKey: 'assignedTo', attributes: ['id', 'nombre', 'email'] }],
            limit: 500,
        });

        let updated = { ok: 0, riesgo: 0, vencido: 0 };

        for (const ticket of tickets) {
            const due       = new Date(ticket.slaDueAt);
            const msLeft    = due - now;
            const totalMs   = due - new Date(ticket.createdAt);
            const pctLeft   = totalMs > 0 ? msLeft / totalMs : 0;

            let newStatus = 'ok';
            if (msLeft < 0)    newStatus = 'vencido';
            else if (pctLeft < 0.20) newStatus = 'riesgo';

            if (newStatus !== ticket.slaStatus) {
                await ticket.update({ slaStatus: newStatus });
                updated[newStatus]++;

                // Notificar al agente asignado si hay riesgo o vencimiento
                if (['riesgo', 'vencido'].includes(newStatus) && ticket.assignedTo) {
                    const agente = ticket.agente;
                    if (agente?.email) {
                        await enqueueEmail({
                            to:       agente.email,
                            subject:  newStatus === 'vencido' ? `SLA VENCIDO: ${ticket.titulo}` : `⚠ SLA en riesgo: ${ticket.titulo}`,
                            template: 'sla-riesgo',
                            vars:     { nombre: agente.nombre, ticketId: ticket.id, titulo: ticket.titulo, estado: newStatus, dueAt: ticket.slaDueAt },
                        });
                    }
                }

                // Evaluar reglas de motor
                const policy = await SLAPolicy.findOne({ where: { prioridad: ticket.priority } });
                const ageMin = Math.round((now - new Date(ticket.createdAt)) / 60000);
                await evalTicket({
                    ticketId:     ticket.id,
                    priority:     ticket.priority,
                    assignedTo:   ticket.assignedTo,
                    categoryName: '',
                    ageMinutes:   ageMin,
                    slaStatus:    newStatus,
                }, 'sla_check');
            }
        }

        logger.info(`[slaMonitor] OK: ${updated.ok} | En riesgo: ${updated.riesgo} | Vencidos: ${updated.vencido}`);
    } catch (err) {
        logger.error('[slaMonitor] Error:', err.message);
    }
}, { timezone: 'America/Lima' });

logger.info('[slaMonitor] Job registrado — cada 5 minutos');
