// ============================================================================
// routes/portal.js — API del portal de autoservicio (items 111-116)
// Mis tickets, crear ticket, comentarios, adjuntos, encuesta
// ============================================================================

const express = require('express');
const router  = express.Router();
const { Op }  = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { Ticket, TicketComment, TicketAttachment, TicketSurvey, Category } = require('../src/models');
const { evalTicket } = require('../src/rules/engine');
const { enqueueEmail } = require('../src/queues/index');
const logger = require('../utils/logger');

// ── GET /api/portal/my-tickets ───────────────────────────────────────────────
router.get('/my-tickets', authenticateToken, async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;
        const where = { createdBy: req.user.id, deletedAt: null };
        if (status) where.status = status;

        const { count, rows } = await Ticket.findAndCountAll({
            where,
            include: [{ model: Category, as: 'categoria', attributes: ['id', 'nombre'] }],
            order:   [['createdAt', 'DESC']],
            limit:   parseInt(limit),
            offset:  (parseInt(page) - 1) * parseInt(limit),
        });

        // Marcar si tiene encuesta pendiente (resuelto/cerrado sin survey)
        const ticketIds = rows.filter(t => ['resuelto','cerrado'].includes(t.status)).map(t => t.id);
        let surveyedIds = new Set();
        if (ticketIds.length) {
            const surveys = await TicketSurvey.findAll({ where: { ticketId: { [Op.in]: ticketIds } }, attributes: ['ticketId'] });
            surveyedIds = new Set(surveys.map(s => s.ticketId));
        }

        const data = rows.map(t => ({ ...t.toJSON(), hasSurvey: surveyedIds.has(t.id) }));
        res.json({ success: true, data, meta: { total: count, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(count / parseInt(limit)) } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/portal/ticket/:id ────────────────────────────────────────────────
router.get('/ticket/:id', authenticateToken, async (req, res) => {
    try {
        const ticket = await Ticket.findOne({
            where:   { id: req.params.id, createdBy: req.user.id, deletedAt: null },
            include: [
                { model: Category,         as: 'categoria' },
                { model: TicketComment,    as: 'comentarios', order: [['createdAt', 'ASC']] },
                { model: TicketAttachment, as: 'adjuntos' },
            ],
        });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        // ¿Ya tiene encuesta?
        const survey = await TicketSurvey.findOne({ where: { ticketId: ticket.id } });
        res.json({ success: true, data: { ...ticket.toJSON(), survey: survey ? true : null } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/portal/pending-survey ───────────────────────────────────────────
// Devuelve el primer ticket resuelto sin encuesta respondida
router.get('/pending-survey', authenticateToken, async (req, res) => {
    try {
        const tickets = await Ticket.findAll({
            where:  { createdBy: req.user.id, status: { [Op.in]: ['resuelto', 'cerrado'] }, deletedAt: null },
            order:  [['resolvedAt', 'DESC']],
            limit:  10,
            attributes: ['id', 'titulo'],
        });
        if (!tickets.length) return res.json({ ticket: null });

        const ids     = tickets.map(t => t.id);
        const surveys = await TicketSurvey.findAll({ where: { ticketId: { [Op.in]: ids } }, attributes: ['ticketId'] });
        const done    = new Set(surveys.map(s => s.ticketId));
        const pending = tickets.find(t => !done.has(t.id));
        res.json({ ticket: pending || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/portal/survey ───────────────────────────────────────────────────
router.post('/survey', authenticateToken, async (req, res) => {
    try {
        const { ticketId, rating, comment } = req.body;
        if (!ticketId || !rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, error: 'ticketId y rating (1-5) requeridos' });
        }
        const ticket = await Ticket.findOne({ where: { id: ticketId, createdBy: req.user.id } });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        const [survey, created] = await TicketSurvey.findOrCreate({
            where:    { ticketId },
            defaults: { userId: req.user.id, rating: parseInt(rating), comment: comment || null },
        });
        if (!created) await survey.update({ rating: parseInt(rating), comment: comment || null });

        res.json({ success: true, data: survey });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/portal/survey/skip ─────────────────────────────────────────────
router.post('/survey/skip', authenticateToken, async (req, res) => {
    try {
        const { ticketId } = req.body;
        if (!ticketId) return res.status(400).json({ success: false, error: 'ticketId requerido' });
        // Crear con skipped=true para no volver a mostrar
        await TicketSurvey.findOrCreate({
            where:    { ticketId },
            defaults: { userId: req.user.id, rating: 0, skipped: true },
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/portal/stats ─────────────────────────────────────────────────────
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [total, open, resolved, avgSurvey] = await Promise.all([
            Ticket.count({ where: { createdBy: userId, deletedAt: null } }),
            Ticket.count({ where: { createdBy: userId, deletedAt: null, status: { [Op.notIn]: ['resuelto','cerrado'] } } }),
            Ticket.count({ where: { createdBy: userId, deletedAt: null, status: 'resuelto' } }),
            TicketSurvey.findOne({
                where: [{ '$Ticket.created_by$': userId }],
                attributes: [[require('../config/database').literal('AVG(rating)'), 'avg']],
                include: [{ model: Ticket, attributes: [] }],
                raw: true,
            }).catch(() => null),
        ]);
        res.json({ success: true, data: { total, open, resolved, avgRating: avgSurvey?.avg ? parseFloat(avgSurvey.avg).toFixed(1) : null } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
