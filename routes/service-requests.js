// routes/service-requests.js
const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const { ServiceRequest, ApprovalFlow, Service, ServiceCategory } = require('../src/models');
const { authenticateToken } = require('../middleware/auth');
const { Op } = require('sequelize');
const { equipmentPool, executeQuery } = require('../config/database');

async function dbQ(sql, p = []) {
    return executeQuery(equipmentPool, sql, p.map(v => v === undefined ? null : v));
}

// ── requester_email column migration ────────────────────────────────────────
(async () => {
    try {
        await dbQ(`ALTER TABLE service_requests ADD COLUMN requester_email VARCHAR(255) DEFAULT NULL`);
    } catch (_) { /* already exists */ }
})();

// ── Software catalog table migration ────────────────────────────────────────
(async () => {
    try {
        await dbQ(`CREATE TABLE IF NOT EXISTS catalog_software (
            id          INT PRIMARY KEY AUTO_INCREMENT,
            nombre      VARCHAR(255) NOT NULL,
            version     VARCHAR(100),
            proveedor   VARCHAR(255),
            categoria   VARCHAR(100) DEFAULT 'Software',
            detalles    TEXT,
            activo      TINYINT(1) DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch(e) { console.error('[service-requests] migration:', e.message); }
})();

// GET /api/service-requests
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, priority, page = 1, limit = 20, mine } = req.query;
        const where = {};
        if (status)   where.status   = status;
        if (priority) where.priority = priority;
        // si mine=1 solo las propias, si no y es admin/especialista ve todas
        const role = req.user?.role || 'usuario';
        const canSeeAll = ['administrador','especialista','agente','tecnico','visor'].includes(role);
        if (!canSeeAll || mine === '1') where.requesterId = req.user.id;

        const { count, rows } = await ServiceRequest.findAndCountAll({
            where,
            include: [
                { model: ApprovalFlow, as: 'approvals', required: false },
                { model: Service, as: 'service',
                  include: [{ model: ServiceCategory, as: 'categoria', required: false }],
                  required: false },
            ],
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
        });
        res.json({ success: true, data: rows, total: count, page: parseInt(page) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/service-requests/catalog
router.get('/catalog', authenticateToken, async (req, res) => {
    try {
        const categories = await ServiceCategory.findAll({
            where: { isActive: true },
            include: [{ model: Service, as: 'servicios', where: { isActive: true }, required: false }],
            order: [['name', 'ASC']],
        });
        res.json({ success: true, data: categories });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/service-requests/software — lista software para autocomplete
router.get('/software', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        let rows;
        if (q) rows = await dbQ(`SELECT * FROM catalog_software WHERE activo=1 AND (nombre LIKE ? OR proveedor LIKE ?) ORDER BY nombre ASC LIMIT 30`, [`%${q}%`, `%${q}%`]);
        else   rows = await dbQ(`SELECT * FROM catalog_software WHERE activo=1 ORDER BY nombre ASC LIMIT 100`);
        res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/service-requests/software — registrar software
router.post('/software', authenticateToken, async (req, res) => {
    try {
        const role = req.user?.role || '';
        if (!['administrador','especialista','agente','tecnico'].includes(role))
            return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { nombre, version, proveedor, categoria, detalles } = req.body;
        if (!nombre) return res.status(400).json({ success: false, error: 'Nombre requerido' });
        const r = await dbQ(`INSERT INTO catalog_software (nombre,version,proveedor,categoria,detalles) VALUES (?,?,?,?,?)`,
            [nombre.trim(), version||null, proveedor||null, categoria||'Software', detalles||null]);
        res.status(201).json({ success: true, id: r.insertId });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/service-requests/software/:id
router.delete('/software/:id', authenticateToken, async (req, res) => {
    try {
        const role = req.user?.role || '';
        if (!['administrador','especialista','agente','tecnico'].includes(role))
            return res.status(403).json({ success: false, error: 'Sin permiso' });
        await dbQ(`UPDATE catalog_software SET activo=0 WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/service-requests/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const sr = await ServiceRequest.findByPk(req.params.id, {
            include: [
                { model: ApprovalFlow, as: 'approvals' },
                { model: Service, as: 'service',
                  include: [{ model: ServiceCategory, as: 'categoria', required: false }],
                  required: false },
            ],
        });
        if (!sr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });
        res.json({ success: true, data: sr });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/service-requests
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, description, serviceId, priority, dueDate, requesterEmail, softwareItems, extraData } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Título requerido' });

        let approvalRequired = false;
        if (serviceId) {
            const svc = await Service.findByPk(serviceId);
            if (svc) approvalRequired = svc.approvalRequired;
        }

        // Build full description merging extra fields
        let fullDesc = description || '';
        if (softwareItems?.length) fullDesc += `\n\n📦 Software solicitado:\n${softwareItems.map(s=>`• ${s}`).join('\n')}`;
        if (extraData) fullDesc += `\n\n📋 Detalles adicionales:\n${extraData}`;

        const sr = await ServiceRequest.create({
            id:             uuidv4(),
            requesterId:    req.user.id,
            serviceId:      serviceId || null,
            title,
            description:    fullDesc,
            priority:       priority || 'media',
            dueDate:        dueDate || null,
            status:         approvalRequired ? 'pendiente_aprobacion' : 'aprobado',
            requesterEmail: requesterEmail || req.user.email || null,
        });
        res.status(201).json({ success: true, data: sr });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/service-requests/:id
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        const sr = await ServiceRequest.findByPk(req.params.id);
        if (!sr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });
        const allowed = ['title','description','status','priority','dueDate','rejectedReason'];
        const updates = {};
        for (const key of allowed) { if (req.body[key] !== undefined) updates[key] = req.body[key]; }
        if (updates.status === 'completado') updates.completedAt = new Date();
        await sr.update(updates);
        res.json({ success: true, data: sr });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/service-requests/:id/approve
router.post('/:id/approve', authenticateToken, async (req, res) => {
    try {
        const sr = await ServiceRequest.findByPk(req.params.id);
        if (!sr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });
        const { decision, comments } = req.body;
        await ApprovalFlow.create({
            id: uuidv4(), serviceRequestId: sr.id,
            approverId: req.user.id, status: decision,
            comments, decidedAt: new Date(),
        });
        const newStatus = decision === 'aprobado' ? 'aprobado' : 'rechazado';
        await sr.update({ status: newStatus, rejectedReason: decision === 'rechazado' ? comments : null });
        res.json({ success: true, data: sr });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/service-requests/:id/notify — enviar correo al solicitante
router.post('/:id/notify', authenticateToken, async (req, res) => {
    try {
        const role = req.user?.role || '';
        if (!['administrador','especialista','agente','tecnico'].includes(role))
            return res.status(403).json({ success: false, error: 'Sin permiso' });

        const sr = await ServiceRequest.findByPk(req.params.id, {
            include: [{ model: Service, as: 'service', required: false }],
        });
        if (!sr) return res.status(404).json({ success: false, error: 'Solicitud no encontrada' });

        const { mensaje, asunto } = req.body;
        const toEmail = sr.requesterEmail;
        if (!toEmail) return res.status(400).json({ success: false, error: 'La solicitud no tiene correo de solicitante registrado' });

        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        const subject = asunto || `Actualización de tu solicitud — ${sr.title}`;
        await transporter.sendMail({
            from: `"Service Desk TI" <${process.env.SMTP_USER}>`,
            to: toEmail,
            subject,
            html: `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table width="600" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
  <tr><td style="background:linear-gradient(135deg,#0052CC,#0065FF);padding:24px 32px;">
    <div style="font-size:20px;font-weight:700;color:#fff;">📋 Solicitud de Servicio TI</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">${subject}</div>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <div style="font-size:14px;color:#374151;line-height:1.7;white-space:pre-line;">${mensaje}</div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <div style="background:#f9fafb;border-radius:8px;padding:16px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:10px;">Detalle de la solicitud</div>
      <table width="100%" style="font-size:13px;color:#374151;">
        <tr><td style="padding:4px 0;width:120px;color:#6b7280;">Solicitud:</td><td><strong>${sr.title}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Estado:</td><td>${sr.status}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Prioridad:</td><td>${sr.priority}</td></tr>
      </table>
    </div>
    <div style="margin-top:20px;font-size:12px;color:#9ca3af;">
      Atendido por: ${req.user.full_name || req.user.email || 'Service Desk TI'}
    </div>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;">
    <div style="font-size:11px;color:#9ca3af;">© Service Desk TI — Responde a este correo si necesitas más ayuda</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
        });
        res.json({ success: true, message: `Correo enviado a ${toEmail}` });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
