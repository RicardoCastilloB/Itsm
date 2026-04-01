// routes/service-requests.js
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { ServiceRequest, ApprovalFlow, Service } = require('../src/models');
const { authenticateToken } = require('../middleware/auth');
const { Op } = require('sequelize');

// GET /api/service-requests
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, priority, page = 1, limit = 20 } = req.query;
        const where = {};
        if (status)   where.status   = status;
        if (priority) where.priority = priority;

        const { count, rows } = await ServiceRequest.findAndCountAll({
            where,
            include: [{ model: ApprovalFlow, as: 'approvals', required: false }],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
        });

        res.json({ success: true, data: rows, total: count, page: parseInt(page) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/service-requests/catalog — servicios disponibles + categorías
router.get('/catalog', authenticateToken, async (req, res) => {
    try {
        const { ServiceCategory } = require('../src/models');
        const categories = await ServiceCategory.findAll({
            where: { isActive: true },
            include: [{ model: Service, as: 'servicios', where: { isActive: true }, required: false }],
            order: [['name', 'ASC']],
        });
        res.json({ success: true, data: categories });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/service-requests/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const sr = await ServiceRequest.findByPk(req.params.id, {
            include: [{ model: ApprovalFlow, as: 'approvals' }],
        });
        if (!sr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });
        res.json({ success: true, data: sr });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/service-requests
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, description, serviceId, priority, dueDate } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Título requerido' });

        let approvalRequired = false;
        if (serviceId) {
            const svc = await Service.findByPk(serviceId);
            if (svc) approvalRequired = svc.approvalRequired;
        }

        const sr = await ServiceRequest.create({
            id:          uuidv4(),
            requesterId: req.user.id,
            serviceId:   serviceId || null,
            title, description, priority: priority || 'media',
            dueDate:     dueDate || null,
            status:      approvalRequired ? 'pendiente_aprobacion' : 'aprobado',
        });

        res.status(201).json({ success: true, data: sr });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/service-requests/:id
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        const sr = await ServiceRequest.findByPk(req.params.id);
        if (!sr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });

        const allowed = ['title','description','status','priority','dueDate','rejectedReason'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        if (updates.status === 'completado') updates.completedAt = new Date();

        await sr.update(updates);
        res.json({ success: true, data: sr });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/service-requests/:id/approve
router.post('/:id/approve', authenticateToken, async (req, res) => {
    try {
        const sr = await ServiceRequest.findByPk(req.params.id);
        if (!sr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });

        const { decision, comments } = req.body; // 'aprobado' | 'rechazado'
        await ApprovalFlow.create({
            id:               uuidv4(),
            serviceRequestId: sr.id,
            approverId:       req.user.id,
            status:           decision,
            comments,
            decidedAt:        new Date(),
        });

        const newStatus = decision === 'aprobado' ? 'aprobado' : 'rechazado';
        await sr.update({ status: newStatus, rejectedReason: decision === 'rechazado' ? comments : null });

        res.json({ success: true, data: sr });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
