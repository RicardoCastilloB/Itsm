// routes/csi.js — Mejora Continua (CSI - ITIL v4)
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }      = require('uuid');
const { CsiInitiative }   = require('../src/models');
const { authenticateToken } = require('../middleware/auth');
const sequelize = require('../src/config/database');
const { QueryTypes } = require('sequelize');

// GET /api/csi/kpis
router.get('/kpis', authenticateToken, async (req, res) => {
    try {
        const [rows] = await sequelize.query(`
            SELECT
              COUNT(*) AS total,
              SUM(status = 'propuesta')    AS propuestas,
              SUM(status = 'en_progreso')  AS en_progreso,
              SUM(status = 'completada')   AS completadas,
              SUM(status = 'cancelada')    AS canceladas,
              AVG(CASE WHEN status = 'completada' THEN improvement_pct END) AS avg_mejora
            FROM csi_initiatives WHERE deleted_at IS NULL
        `, { type: QueryTypes.SELECT });
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/csi
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, priority, page = 1, limit = 20 } = req.query;
        const where = {};
        if (status)   where.status   = status;
        if (priority) where.priority = priority;

        const { count, rows } = await CsiInitiative.findAndCountAll({
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

// GET /api/csi/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const item = await CsiInitiative.findByPk(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'Iniciativa no encontrada' });
        res.json({ success: true, data: item });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/csi
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, description, objective, priority, targetDate,
                metric, baselineValue, targetValue, improvementPct } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Título requerido' });

        const item = await CsiInitiative.create({
            id: uuidv4(), title, description, objective,
            priority:       priority   || 'media',
            ownerId:        req.user.id,
            targetDate:     targetDate || null,
            metric, baselineValue, targetValue, improvementPct,
        });
        res.status(201).json({ success: true, data: item });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/csi/:id
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        const item = await CsiInitiative.findByPk(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'Iniciativa no encontrada' });

        const allowed = ['title','description','objective','status','priority','targetDate',
                         'completedDate','metric','baselineValue','targetValue','actualValue','improvementPct'];
        const updates = {};
        for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
        if (updates.status === 'completada' && !updates.completedDate) updates.completedDate = new Date().toISOString().slice(0,10);
        await item.update(updates);
        res.json({ success: true, data: item });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/csi/:id
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const item = await CsiInitiative.findByPk(req.params.id);
        if (!item) return res.status(404).json({ success: false, error: 'Iniciativa no encontrada' });
        await item.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
