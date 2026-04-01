// routes/notifications.js
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }    = require('uuid');
const { Notification }  = require('../src/models');
const { authenticateToken } = require('../middleware/auth');

// GET /api/notifications — las del usuario autenticado
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { unread, limit = 30 } = req.query;
        const where = { userId: req.user.id };
        if (unread === '1') where.isRead = false;

        const notifs = await Notification.findAll({
            where,
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
        });
        const unreadCount = await Notification.count({ where: { userId: req.user.id, isRead: false } });
        res.json({ success: true, data: notifs, unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticateToken, async (req, res) => {
    try {
        await Notification.update(
            { isRead: true, readAt: new Date() },
            { where: { id: req.params.id, userId: req.user.id } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', authenticateToken, async (req, res) => {
    try {
        await Notification.update(
            { isRead: true, readAt: new Date() },
            { where: { userId: req.user.id, isRead: false } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/notifications — crear (uso interno desde otros módulos)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { userId, type, title, body, data } = req.body;
        const n = await Notification.create({
            id: uuidv4(),
            userId: userId || req.user.id,
            type, title, body, data,
        });
        // Emitir Socket.io si está disponible
        const io = req.app.get('io');
        if (io) io.to(`user:${n.userId}`).emit('notification', n.toJSON());
        res.status(201).json({ success: true, data: n });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
