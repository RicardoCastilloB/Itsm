// routes/problems.js
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Problem, KnownError } = require('../src/models');
const { authenticateToken } = require('../middleware/auth');
const sequelize = require('../src/config/database');
const { QueryTypes } = require('sequelize');

async function nextProblemNumber() {
    const year = new Date().getFullYear();
    const prefix = `PRB-${year}-`;
    const [row] = await sequelize.query(
        `SELECT problem_number FROM problems WHERE problem_number LIKE ? ORDER BY problem_number DESC LIMIT 1`,
        { replacements: [`${prefix}%`], type: QueryTypes.SELECT }
    );
    const seq = row ? parseInt(row.problem_number.split('-').pop()) + 1 : 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
}

// GET /api/problems
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, priority, page = 1, limit = 20 } = req.query;
        const where = {};
        if (status)   where.status   = status;
        if (priority) where.priority = priority;

        const { count, rows } = await Problem.findAndCountAll({
            where,
            include: [{ model: KnownError, as: 'erroresConocidos', required: false }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
        });
        res.json({ success: true, data: rows, total: count, page: parseInt(page) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/problems/kpis
router.get('/kpis', authenticateToken, async (req, res) => {
    try {
        const [rows] = await sequelize.query(`
            SELECT
              SUM(status NOT IN ('resuelto','cerrado'))  AS abiertos,
              SUM(status = 'en_investigacion')            AS investigacion,
              SUM(status = 'conocido')                    AS conocidos,
              SUM(status IN ('resuelto','cerrado'))        AS resueltos
            FROM problems WHERE deleted_at IS NULL
        `, { type: QueryTypes.SELECT });
        const [ke] = await sequelize.query(
            `SELECT COUNT(*) AS total FROM known_errors WHERE deleted_at IS NULL AND is_published = 1`,
            { type: QueryTypes.SELECT }
        );
        res.json({ success: true, data: { ...rows[0], erroresPublicados: ke[0].total } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/problems/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const p = await Problem.findByPk(req.params.id, {
            include: [{ model: KnownError, as: 'erroresConocidos' }],
        });
        if (!p) return res.status(404).json({ success: false, error: 'Problema no encontrado' });
        res.json({ success: true, data: p });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/problems
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, description, priority, workaround } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Título requerido' });

        const problemNumber = await nextProblemNumber();
        const p = await Problem.create({
            id: uuidv4(),
            problemNumber, title, description,
            priority: priority || 'media',
            workaround: workaround || null,
            assignedTo: req.user.id,
        });
        res.status(201).json({ success: true, data: p });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/problems/:id
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        const p = await Problem.findByPk(req.params.id);
        if (!p) return res.status(404).json({ success: false, error: 'Problema no encontrado' });

        const allowed = ['title','description','status','priority','assignedTo','rootCause','workaround','resolution'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        if (updates.status === 'resuelto' || updates.status === 'cerrado') {
            updates.resolvedAt = new Date();
        }
        await p.update(updates);
        res.json({ success: true, data: p });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/problems/:id/known-errors
router.post('/:id/known-errors', authenticateToken, async (req, res) => {
    try {
        const p = await Problem.findByPk(req.params.id);
        if (!p) return res.status(404).json({ success: false, error: 'Problema no encontrado' });

        const { title, symptoms, workaround, resolution, isPublished } = req.body;
        const ke = await KnownError.create({
            id: uuidv4(),
            problemId: p.id,
            title, symptoms, workaround, resolution,
            isPublished: !!isPublished,
            publishedAt: isPublished ? new Date() : null,
        });
        res.status(201).json({ success: true, data: ke });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
