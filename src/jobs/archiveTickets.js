// ============================================================================
// src/jobs/archiveTickets.js — Job mensual (1ro del mes, 2am): archivar tickets
// Item 127: tickets cerrados con más de 90 días → tabla ticket_archive
// ============================================================================

const cron = require('node-cron');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Ticket, Category } = require('../models');
const logger = require('../../utils/logger');

// 1ro de cada mes a las 2am
cron.schedule('0 2 1 * *', async () => {
    logger.info('[archiveTickets] Iniciando archivado mensual...');
    try {
        const count = await archiveOldTickets();
        logger.info(`[archiveTickets] ${count} tickets archivados`);
    } catch (err) {
        logger.error('[archiveTickets] Error:', err.message);
    }
}, { timezone: 'America/Lima' });

async function archiveOldTickets(daysOld = 90) {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    // Obtener tickets a archivar
    const tickets = await Ticket.findAll({
        where: {
            status:    { [Op.in]: ['cerrado', 'resuelto'] },
            closedAt:  { [Op.lt]: cutoff },
            deletedAt: null,
        },
        include: [{ model: Category, as: 'categoria', attributes: ['nombre'] }],
        limit: 1000,
    });

    if (!tickets.length) {
        logger.info('[archiveTickets] No hay tickets para archivar');
        return 0;
    }

    const t = await sequelize.transaction();
    try {
        // INSERT INTO ticket_archive
        const rows = tickets.map(tk => ({
            id:                  tk.id,
            titulo:              tk.titulo,
            descripcion:         tk.descripcion,
            tipo:                tk.tipo,
            status:              tk.status,
            priority:            tk.priority,
            category_id:         tk.categoryId,
            category_name:       tk.categoria?.nombre || null,
            assigned_to:         tk.assignedTo,
            created_by:          tk.createdBy,
            sla_status:          tk.slaStatus,
            sla_due_at:          tk.slaDueAt,
            resolved_at:         tk.resolvedAt,
            closed_at:           tk.closedAt,
            metadata:            tk.metadata ? JSON.stringify(tk.metadata) : null,
            original_created_at: tk.createdAt,
        }));

        // Bulk INSERT IGNORE (por si ya existe)
        for (const row of rows) {
            await sequelize.query(`
                INSERT IGNORE INTO ticket_archive
                  (id, titulo, descripcion, tipo, status, priority,
                   category_id, category_name, assigned_to, created_by,
                   sla_status, sla_due_at, resolved_at, closed_at, metadata, original_created_at)
                VALUES (:id,:titulo,:descripcion,:tipo,:status,:priority,
                        :category_id,:category_name,:assigned_to,:created_by,
                        :sla_status,:sla_due_at,:resolved_at,:closed_at,:metadata,:original_created_at)
            `, { replacements: row, transaction: t });
        }

        // Soft-delete los tickets originales (paranoid: true)
        const ids = tickets.map(tk => tk.id);
        await Ticket.destroy({ where: { id: { [Op.in]: ids } }, transaction: t });

        await t.commit();
        logger.info(`[archiveTickets] ${rows.length} tickets movidos al archivo`);
        return rows.length;
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

module.exports = { archiveOldTickets };
logger.info('[archiveTickets] Job registrado — 1ro de mes 2am');
