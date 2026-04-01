// routes/catalog.js — Catálogo de Servicios
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Service, ServiceCategory } = require('../src/models');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/catalog/categories
router.get('/categories', authenticateToken, async (req, res) => {
    try {
        const cats = await ServiceCategory.findAll({
            where: { isActive: true },
            order: [['name', 'ASC']],
        });
        res.json({ success: true, data: cats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/catalog
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { categoryId, search } = req.query;
        const where = { isActive: true };
        if (categoryId) where.categoryId = categoryId;
        if (search) {
            const { Op } = require('sequelize');
            where.name = { [Op.like]: `%${search}%` };
        }

        const services = await Service.findAll({
            where,
            include: [{ model: ServiceCategory, as: 'categoria' }],
            order: [['name', 'ASC']],
        });
        res.json({ success: true, data: services });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/catalog/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const svc = await Service.findByPk(req.params.id, {
            include: [{ model: ServiceCategory, as: 'categoria' }],
        });
        if (!svc) return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
        res.json({ success: true, data: svc });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/catalog  (admin)
router.post('/', authenticateToken, requireRole('administrador'), async (req, res) => {
    try {
        const { categoryId, name, description, slaHours, approvalRequired, approverRole, formSchema } = req.body;
        if (!categoryId || !name) return res.status(400).json({ success: false, error: 'categoryId y name requeridos' });

        const svc = await Service.create({
            id: uuidv4(),
            categoryId, name, description,
            slaHours:         slaHours         || 8,
            approvalRequired: !!approvalRequired,
            approverRole:     approverRole      || null,
            formSchema:       formSchema        || null,
        });
        res.status(201).json({ success: true, data: svc });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/catalog/:id (admin)
router.patch('/:id', authenticateToken, requireRole('administrador'), async (req, res) => {
    try {
        const svc = await Service.findByPk(req.params.id);
        if (!svc) return res.status(404).json({ success: false, error: 'Servicio no encontrado' });

        const allowed = ['name','description','slaHours','approvalRequired','approverRole','formSchema','isActive'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        await svc.update(updates);
        res.json({ success: true, data: svc });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/catalog/:id (admin)
router.delete('/:id', authenticateToken, requireRole('administrador'), async (req, res) => {
    try {
        const svc = await Service.findByPk(req.params.id);
        if (!svc) return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
        await svc.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
