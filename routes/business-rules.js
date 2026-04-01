// ============================================================================
// routes/business-rules.js — CRUD de reglas de negocio (items 121-122)
// Requiere rol admin. Invalida cache del motor al crear/actualizar/eliminar.
// ============================================================================

const express = require('express');
const router  = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { BusinessRule }      = require('../src/models');
const { invalidateCache }   = require('../src/rules/engine');
const logger = require('../utils/logger');

const adminOnly = [authenticateToken, requireRole('administrador')];

// ── GET /api/business-rules ─────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
    try {
        const rules = await BusinessRule.findAll({ order: [['priority', 'ASC'], ['id', 'ASC']] });
        res.json({ success: true, data: rules });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/business-rules/:id ─────────────────────────────────────────────
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const rule = await BusinessRule.findByPk(req.params.id);
        if (!rule) return res.status(404).json({ success: false, error: 'Regla no encontrada' });
        res.json({ success: true, data: rule });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/business-rules ─────────────────────────────────────────────────
router.post('/', ...adminOnly, async (req, res) => {
    try {
        const { name, description, conditions, actions, isActive, priority, runOn } = req.body;
        if (!name || !conditions || !actions) {
            return res.status(400).json({ success: false, error: 'name, conditions y actions son requeridos' });
        }
        const rule = await BusinessRule.create({
            name, description, conditions, actions,
            isActive: isActive !== false,
            priority: priority || 10,
            runOn:    runOn    || 'ticket_created',
            createdBy: req.user.id,
        });
        invalidateCache();
        res.status(201).json({ success: true, data: rule });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PATCH /api/business-rules/:id ───────────────────────────────────────────
router.patch('/:id', ...adminOnly, async (req, res) => {
    try {
        const rule = await BusinessRule.findByPk(req.params.id);
        if (!rule) return res.status(404).json({ success: false, error: 'Regla no encontrada' });
        const { name, description, conditions, actions, isActive, priority, runOn } = req.body;
        await rule.update({ name, description, conditions, actions, isActive, priority, runOn });
        invalidateCache();
        res.json({ success: true, data: rule });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PATCH /api/business-rules/:id/toggle ────────────────────────────────────
router.patch('/:id/toggle', ...adminOnly, async (req, res) => {
    try {
        const rule = await BusinessRule.findByPk(req.params.id);
        if (!rule) return res.status(404).json({ success: false, error: 'Regla no encontrada' });
        await rule.update({ isActive: !rule.isActive });
        invalidateCache();
        res.json({ success: true, data: { id: rule.id, isActive: rule.isActive } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── DELETE /api/business-rules/:id ──────────────────────────────────────────
router.delete('/:id', ...adminOnly, async (req, res) => {
    try {
        const rule = await BusinessRule.findByPk(req.params.id);
        if (!rule) return res.status(404).json({ success: false, error: 'Regla no encontrada' });
        await rule.destroy();
        invalidateCache();
        res.json({ success: true, message: 'Regla eliminada' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/business-rules/test ───────────────────────────────────────────
// Probar reglas contra un contexto sin aplicar acciones
router.post('/test', ...adminOnly, async (req, res) => {
    try {
        const { evalTicket } = require('../src/rules/engine');
        const results = await evalTicket(req.body, req.body.runOn || 'ticket_created');
        res.json({ success: true, matched: results.length, data: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
