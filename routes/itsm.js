// ============================================================================
// routes/itsm.js — CRUD de tickets ITSM
// Items 48-51: crear, listar, filtros, paginación, historial de cambios
// ============================================================================

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { Op }   = require('sequelize');
const router   = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { Ticket, TicketComment, TicketAttachment, Category, SLAPolicy } = require('../src/models');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');

// ── Multer para adjuntos ──────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../uploads/tickets');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// ── Calcular sla_due_at según prioridad ───────────────────────────────────
async function calcularSlaDueAt(priority) {
    const policy = await SLAPolicy.findOne({ where: { prioridad: priority } });
    if (!policy) return null;
    const ahora = new Date();
    return new Date(ahora.getTime() + policy.tiempoResolucionH * 60 * 60 * 1000);
}

// ── Registrar cambio de estado en historial ───────────────────────────────
async function registrarCambioEstado(ticketId, userId, from, to) {
    await TicketComment.create({
        ticketId,
        userId,
        contenido: `Estado cambiado de "${from}" a "${to}"`,
        tipo:      'cambio_estado',
        metadata:  { from, to },
    });
}

// ============================================================================
// GET /api/itsm/tickets — Listar con filtros y paginación
// ============================================================================
router.get('/tickets', authenticateToken, async (req, res) => {
    try {
        const {
            status, priority, tipo, category_id, assigned_to,
            sla_status, search,
            page = 1, limit = 25,
            date_from, date_to,
        } = req.query;

        const where = { deletedAt: null };

        if (status)      where.status    = status;
        if (priority)    where.priority  = priority;
        if (tipo)        where.tipo      = tipo;
        if (category_id) where.categoryId = parseInt(category_id);
        if (assigned_to) where.assignedTo = assigned_to;
        if (sla_status)  where.slaStatus  = sla_status;

        if (search) {
            where[Op.or] = [
                { titulo:      { [Op.like]: `%${search}%` } },
                { descripcion: { [Op.like]: `%${search}%` } },
            ];
        }

        if (date_from || date_to) {
            where.createdAt = {};
            if (date_from) where.createdAt[Op.gte] = new Date(date_from);
            if (date_to)   where.createdAt[Op.lte] = new Date(date_to + 'T23:59:59');
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows } = await Ticket.findAndCountAll({
            where,
            include: [{ model: Category, as: 'categoria', attributes: ['id', 'nombre', 'area'] }],
            order:   [['createdAt', 'DESC']],
            limit:   parseInt(limit),
            offset,
        });

        return res.json({
            success: true,
            data:    rows,
            meta: {
                total:    count,
                page:     parseInt(page),
                limit:    parseInt(limit),
                pages:    Math.ceil(count / parseInt(limit)),
            },
        });
    } catch (error) {
        logger.error('GET /itsm/tickets error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/itsm/tickets/kpis — Contadores para las tarjetas KPI
// ============================================================================
router.get('/tickets/kpis', authenticateToken, async (req, res) => {
    try {
        const base = { deletedAt: null };

        const [total, abiertos, en_progreso, pendientes, resueltos, p1, p2, vencidos] = await Promise.all([
            Ticket.count({ where: base }),
            Ticket.count({ where: { ...base, status: 'abierto' } }),
            Ticket.count({ where: { ...base, status: 'en_progreso' } }),
            Ticket.count({ where: { ...base, status: 'pendiente' } }),
            Ticket.count({ where: { ...base, status: 'resuelto' } }),
            Ticket.count({ where: { ...base, priority: 'P1', status: { [Op.notIn]: ['cerrado','resuelto'] } } }),
            Ticket.count({ where: { ...base, priority: 'P2', status: { [Op.notIn]: ['cerrado','resuelto'] } } }),
            Ticket.count({ where: { ...base, slaStatus: 'vencido', status: { [Op.notIn]: ['cerrado','resuelto'] } } }),
        ]);

        return res.json({ success: true, data: { total, abiertos, en_progreso, pendientes, resueltos, p1, p2, vencidos } });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/itsm/tickets/:id — Detalle con comentarios y adjuntos
// ============================================================================
router.get('/tickets/:id', authenticateToken, async (req, res) => {
    try {
        const ticket = await Ticket.findOne({
            where:   { id: req.params.id, deletedAt: null },
            include: [
                { model: Category,         as: 'categoria', attributes: ['id', 'nombre', 'area'] },
                { model: TicketComment,    as: 'comentarios', order: [['createdAt', 'ASC']] },
                { model: TicketAttachment, as: 'adjuntos' },
            ],
        });

        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        return res.json({ success: true, data: ticket });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// POST /api/itsm/tickets — Crear ticket
// ============================================================================
router.post('/tickets', authenticateToken, async (req, res) => {
    try {
        const { titulo, descripcion, tipo, priority = 'P3', category_id, assigned_to, metadata } = req.body;

        if (!titulo) return res.status(400).json({ success: false, error: 'El título es requerido' });

        const slaDueAt = await calcularSlaDueAt(priority);

        const ticket = await Ticket.create({
            titulo,
            descripcion: descripcion || null,
            tipo:        tipo || 'incidente',
            priority,
            categoryId:  category_id || null,
            assignedTo:  assigned_to || null,
            createdBy:   req.user?.id || null,
            slaDueAt,
            metadata:    metadata || null,
        });

        // Comentario de sistema al crear
        await TicketComment.create({
            ticketId:  ticket.id,
            userId:    req.user?.id || null,
            contenido: `Ticket creado por ${req.user?.username || 'sistema'}`,
            tipo:      'sistema',
        });

        await logAudit(req, 'create_ticket', 'tickets', ticket.id, { titulo, priority, tipo });

        return res.status(201).json({ success: true, data: ticket });
    } catch (error) {
        logger.error('POST /itsm/tickets error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// PATCH /api/itsm/tickets/:id — Actualizar status, asignar agente, etc.
// ============================================================================
router.patch('/tickets/:id', authenticateToken, async (req, res) => {
    try {
        const ticket = await Ticket.findOne({ where: { id: req.params.id, deletedAt: null } });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        const { status, priority, assigned_to, titulo, descripcion, category_id, metadata } = req.body;
        const prevStatus = ticket.status;

        // Registrar cambio de estado en historial
        if (status && status !== prevStatus) {
            await registrarCambioEstado(ticket.id, req.user?.id, prevStatus, status);

            if (status === 'resuelto') ticket.resolvedAt = new Date();
            if (status === 'cerrado')  ticket.closedAt   = new Date();
        }

        // Registrar cambio de asignación
        if (assigned_to && assigned_to !== ticket.assignedTo) {
            await TicketComment.create({
                ticketId:  ticket.id,
                userId:    req.user?.id || null,
                contenido: `Ticket asignado a usuario ${assigned_to}`,
                tipo:      'asignacion',
                metadata:  { from: ticket.assignedTo, to: assigned_to },
            });
        }

        if (status)      ticket.status     = status;
        if (priority)    { ticket.priority = priority; ticket.slaDueAt = await calcularSlaDueAt(priority); }
        if (assigned_to) ticket.assignedTo = assigned_to;
        if (titulo)      ticket.titulo     = titulo;
        if (descripcion !== undefined) ticket.descripcion = descripcion;
        if (category_id !== undefined) ticket.categoryId  = category_id;
        if (metadata)    ticket.metadata   = metadata;

        await ticket.save();
        await logAudit(req, 'update_ticket', 'tickets', ticket.id, req.body);

        return res.json({ success: true, data: ticket });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// DELETE /api/itsm/tickets/:id — Soft delete
// ============================================================================
router.delete('/tickets/:id', authenticateToken, async (req, res) => {
    try {
        const ticket = await Ticket.findOne({ where: { id: req.params.id, deletedAt: null } });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        ticket.deletedAt = new Date();
        await ticket.save();
        await logAudit(req, 'delete_ticket', 'tickets', ticket.id);

        return res.json({ success: true, message: 'Ticket eliminado' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// POST /api/itsm/tickets/:id/comments — Agregar comentario
// ============================================================================
router.post('/tickets/:id/comments', authenticateToken, async (req, res) => {
    try {
        const { contenido } = req.body;
        if (!contenido) return res.status(400).json({ success: false, error: 'El contenido es requerido' });

        const ticket = await Ticket.findOne({ where: { id: req.params.id, deletedAt: null } });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        const comment = await TicketComment.create({
            ticketId:  ticket.id,
            userId:    req.user?.id || null,
            contenido,
            tipo:      'comentario',
        });

        return res.status(201).json({ success: true, data: comment });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// POST /api/itsm/tickets/:id/attachments — Subir adjunto
// ============================================================================
router.post('/tickets/:id/attachments', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió archivo' });

        const ticket = await Ticket.findOne({ where: { id: req.params.id, deletedAt: null } });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        const attachment = await TicketAttachment.create({
            ticketId:  ticket.id,
            userId:    req.user?.id || null,
            filename:  req.file.filename,
            original:  req.file.originalname,
            mimetype:  req.file.mimetype,
            sizeBytes: req.file.size,
        });

        return res.status(201).json({ success: true, data: attachment });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/itsm/categories — Listado de categorías
// ============================================================================
router.get('/categories', authenticateToken, async (req, res) => {
    try {
        const cats = await Category.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] });
        return res.json({ success: true, data: cats });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
