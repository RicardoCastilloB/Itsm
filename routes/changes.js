// routes/changes.js
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Change } = require('../src/models');
const { authenticateToken } = require('../middleware/auth');
const sequelize = require('../src/config/database');
const { QueryTypes } = require('sequelize');

// Auto-generate change number  CHG-YYYYMMDD-XXXX
async function nextChangeNumber() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `CHG-${today}-`;
    const [row] = await sequelize.query(
        `SELECT change_number FROM changes WHERE change_number LIKE ? ORDER BY change_number DESC LIMIT 1`,
        { replacements: [`${prefix}%`], type: QueryTypes.SELECT }
    );
    const seq = row ? parseInt(row.change_number.split('-').pop()) + 1 : 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
}

// GET /api/changes
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, type, risk, page = 1, limit = 20 } = req.query;
        const where = {};
        if (status) where.status    = status;
        if (type)   where.type      = type;
        if (risk)   where.riskLevel = risk;

        const { count, rows } = await Change.findAndCountAll({
            where,
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
        });
        res.json({ success: true, data: rows, total: count, page: parseInt(page) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/changes/kpis
router.get('/kpis', authenticateToken, async (req, res) => {
    try {
        const [rows] = await sequelize.query(`
            SELECT
              SUM(status NOT IN ('implementado','cancelado','revisado'))         AS activos,
              SUM(status = 'pendiente_aprobacion')                               AS pendientes,
              SUM(status IN ('implementado','revisado'))                          AS implementados,
              SUM(type = 'emergencia' AND status NOT IN ('cancelado','revisado')) AS emergencias
            FROM changes WHERE deleted_at IS NULL
        `, { type: QueryTypes.SELECT });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/changes/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const ch = await Change.findByPk(req.params.id);
        if (!ch) return res.status(404).json({ success: false, error: 'Cambio no encontrado' });
        res.json({ success: true, data: ch });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/changes
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, description, type, priority, riskLevel, plannedStart, plannedEnd, rollbackPlan, testPlan } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Título requerido' });

        const changeNumber = await nextChangeNumber();
        const ch = await Change.create({
            id: uuidv4(),
            changeNumber,
            title, description,
            type:        type        || 'normal',
            priority:    priority    || 'media',
            riskLevel:   riskLevel   || 'medio',
            requestedBy: req.user.id,
            plannedStart: plannedStart || null,
            plannedEnd:   plannedEnd   || null,
            rollbackPlan: rollbackPlan || null,
            testPlan:     testPlan     || null,
        });
        res.status(201).json({ success: true, data: ch });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/changes/:id
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        const ch = await Change.findByPk(req.params.id);
        if (!ch) return res.status(404).json({ success: false, error: 'Cambio no encontrado' });

        const allowed = ['title','description','type','status','priority','riskLevel',
                         'assignedTo','plannedStart','plannedEnd','actualStart','actualEnd',
                         'rollbackPlan','testPlan','implementationNotes','postImplReview',
                         'cabApprovedAt','cabApprovedBy'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        await ch.update(updates);
        res.json({ success: true, data: ch });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/changes/:id
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const ch = await Change.findByPk(req.params.id);
        if (!ch) return res.status(404).json({ success: false, error: 'Cambio no encontrado' });
        await ch.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
