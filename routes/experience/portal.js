// ============================================================================
// routes/portal.js — API del portal de autoservicio (items 111-116)
// Mis tickets, crear ticket, comentarios, adjuntos, encuesta
// ============================================================================

const express = require('express');
const router  = express.Router();
const { Op }  = require('sequelize');
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { Ticket, TicketComment, TicketAttachment, TicketSurvey, Category } = require('../../src/models');
const { evalTicket } = require('../../src/rules/engine');
const { enqueueEmail } = require('../../src/queues/index');
const { equipmentPool, executeQuery } = require('../../config/database');
const logger = require('../../utils/logger');

// ── POST /api/portal/identify — público, sin auth ────────────────────────────
router.post('/identify', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });
        const emailLower = email.toLowerCase().trim();

        // 1. Check if has ITSM account with elevated role
        const itsmRows = await executeQuery(equipmentPool,
            `SELECT role, full_name FROM users WHERE email = ? AND is_active = 1 LIMIT 1`,
            [emailLower]
        );
        if (itsmRows.length > 0) {
            const u = itsmRows[0];
            const elevated = ['administrador', 'especialista', 'agente', 'tecnico'];
            if (elevated.includes(u.role)) {
                return res.json({ success: true, type: 'admin', name: u.full_name, role: u.role });
            }
            // ITSM user but regular role
            return res.json({ success: true, type: 'employee', name: u.full_name });
        }

        // 2. Check employees table
        const empRows = await executeQuery(equipmentPool,
            `SELECT email, full_name, position_name FROM employees WHERE email = ? AND is_active = 1 LIMIT 1`,
            [emailLower]
        );
        if (empRows.length > 0) {
            return res.json({ success: true, type: 'employee', name: empRows[0].full_name });
        }

        // 3. Not found — check domain
        const domain = emailLower.split('@')[1] || '';
        if (domain === 'integratel.com.pe') {
            // Send welcome email
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
                    secure: process.env.SMTP_SECURE === 'true',
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                });
                await transporter.sendMail({
                    from: `"Service Desk TI" <${process.env.SMTP_USER}>`,
                    to: emailLower,
                    subject: 'Bienvenido al Portal de Servicios TI — Integratel',
                    html: `<!DOCTYPE html><html lang="es"><body style="font-family:-apple-system,sans-serif;background:#f4f5f7;padding:32px 16px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="560" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
  <tr><td style="background:linear-gradient(135deg,#0052CC,#0065FF);padding:24px 32px;">
    <div style="font-size:18px;font-weight:700;color:#fff;">🎧 Portal de Servicios TI — Integratel</div>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:14px;color:#374151;">Hola, tu correo <strong>${emailLower}</strong> ha sido registrado en el portal de autogestión.</p>
    <p style="font-size:14px;color:#374151;">Ahora puedes acceder al <strong>Catálogo de Servicios</strong> para realizar solicitudes al equipo de TI.</p>
    <div style="margin-top:20px;padding:12px 16px;background:#eff6ff;border-radius:8px;font-size:12px;color:#1e40af;">
      Si tienes preguntas, responde a este correo o contáctanos directamente.
    </div>
  </td></tr>
</table></td></tr></table></body></html>`,
                });
            } catch(mailErr) { logger.warn('Email bienvenida no enviado:', mailErr.message); }
            return res.json({ success: true, type: 'new_registered', email: emailLower });
        }

        return res.json({ success: false, type: 'not_found', error: 'Correo no encontrado. Solo se permite el dominio @integratel.com.pe' });
    } catch (err) {
        logger.error('Error en identify:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/portal/activity-log — público, métricas del portal ─────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_activity_log (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                email      VARCHAR(255) NOT NULL,
                action     VARCHAR(100) NOT NULL,
                page       VARCHAR(100) DEFAULT 'portal',
                metadata   JSON,
                ip         VARCHAR(45),
                created_at DATETIME DEFAULT NOW(),
                INDEX idx_email (email),
                INDEX idx_action (action),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { logger.warn('portal_activity_log migration:', e.message); }
})();

router.post('/activity-log', async (req, res) => {
    try {
        const { email, action, page = 'portal', metadata } = req.body;
        if (!email || !action) return res.status(400).json({ success: false, error: 'email y action requeridos' });
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || null;
        await executeQuery(equipmentPool,
            `INSERT INTO portal_activity_log (email, action, page, metadata, ip) VALUES (?,?,?,?,?)`,
            [email.toLowerCase().trim(), action, page, metadata ? JSON.stringify(metadata) : null, ip]
        );
        res.json({ success: true });
    } catch(err) {
        res.json({ success: true }); // non-blocking: don't break user flow on log error
    }
});

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
                attributes: [[require('../../config/database').literal('AVG(rating)'), 'avg']],
                include: [{ model: Ticket, attributes: [] }],
                raw: true,
            }).catch(() => null),
        ]);
        res.json({ success: true, data: { total, open, resolved, avgRating: avgSurvey?.avg ? parseFloat(avgSurvey.avg).toFixed(1) : null } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PORTAL SURVEYS GENERAL ────────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_surveys_general (
                id                INT AUTO_INCREMENT PRIMARY KEY,
                email             VARCHAR(200) NOT NULL,
                full_name         VARCHAR(200),
                rating            TINYINT NOT NULL,
                rating_equipment  TINYINT DEFAULT NULL,
                rating_app        TINYINT DEFAULT NULL,
                app_name          VARCHAR(200) DEFAULT NULL,
                comment           TEXT,
                created_at        DATETIME DEFAULT NOW(),
                UNIQUE KEY uk_email (email),
                INDEX idx_rating (rating)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        await executeQuery(equipmentPool, `ALTER TABLE portal_surveys_general ADD COLUMN IF NOT EXISTS email VARCHAR(200) NOT NULL DEFAULT ''`).catch(()=>{});
        await executeQuery(equipmentPool, `ALTER TABLE portal_surveys_general ADD COLUMN IF NOT EXISTS full_name VARCHAR(200)`).catch(()=>{});
        await executeQuery(equipmentPool, `ALTER TABLE portal_surveys_general ADD COLUMN IF NOT EXISTS rating_equipment TINYINT DEFAULT NULL`).catch(()=>{});
        await executeQuery(equipmentPool, `ALTER TABLE portal_surveys_general ADD COLUMN IF NOT EXISTS rating_app TINYINT DEFAULT NULL`).catch(()=>{});
        await executeQuery(equipmentPool, `ALTER TABLE portal_surveys_general ADD COLUMN IF NOT EXISTS app_name VARCHAR(200) DEFAULT NULL`).catch(()=>{});
        await executeQuery(equipmentPool, `ALTER TABLE portal_surveys_general DROP INDEX user_id`).catch(()=>{});
        await executeQuery(equipmentPool, `ALTER TABLE portal_surveys_general ADD UNIQUE KEY uk_email (email)`).catch(()=>{});
        await executeQuery(equipmentPool,
            `UPDATE portal_surveys_general psg
             JOIN employees e ON LOWER(TRIM(e.full_name)) = LOWER(TRIM(psg.full_name))
             SET psg.email = LOWER(e.email)
             WHERE psg.full_name IS NOT NULL AND psg.full_name != ''
               AND (psg.email = '' OR psg.email NOT LIKE CONCAT('%', SUBSTRING_INDEX(LOWER(TRIM(psg.full_name)),' ',1), '%'))`
        ).catch(()=>{});
    } catch(e) { /* BD no disponible */ }
})();

// ── POST /api/portal/survey-general — encuesta de satisfacción (público) ──────
router.post('/survey-general', async (req, res) => {
    try {
        const { rating, rating_equipment, rating_app, app_name, comment, portalEmail, portalName } = req.body;
        if (!rating || rating < 1 || rating > 5)
            return res.status(400).json({ success: false, error: 'rating 1-5 requerido' });
        const email    = (portalEmail || '').toLowerCase().trim();
        const fullName = (portalName  || '').trim();
        if (!email) return res.json({ success: true });
        const rEquip = rating_equipment ? Math.min(5, Math.max(1, parseInt(rating_equipment))) : null;
        const rApp   = rating_app       ? Math.min(5, Math.max(1, parseInt(rating_app)))       : null;
        const appNm  = app_name ? app_name.toString().trim().slice(0, 200) : null;
        await executeQuery(equipmentPool,
            `INSERT INTO portal_surveys_general (email, full_name, rating, rating_equipment, rating_app, app_name, comment, created_at)
             VALUES (?,?,?,?,?,?,?,NOW())
             ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),
               rating=VALUES(rating), rating_equipment=VALUES(rating_equipment),
               rating_app=VALUES(rating_app), app_name=VALUES(app_name),
               comment=VALUES(comment), created_at=NOW()`,
            [email, fullName, parseInt(rating), rEquip, rApp, appNm, comment || null]
        );
        res.json({ success: true });
    } catch(err) {
        res.json({ success: true });
    }
});

// ── GET /api/portal/survey-general/results — resultados para admin ───────────
router.get('/survey-general/results', authenticateToken, async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT id, email, full_name, rating, rating_equipment, rating_app, app_name, comment, created_at
             FROM portal_surveys_general
             ORDER BY rating ASC, created_at DESC`,
            []
        );
        res.json({ success: true, data: rows });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/portal/survey-general/:id/send-email — enviar correo de feedback ─
router.post('/survey-general/:id/send-email', authenticateToken, async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT id, email, full_name, rating, comment
             FROM portal_surveys_general WHERE id = ?`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, error: 'No encontrado' });
        const s = rows[0];
        const { questions = [] } = req.body;
        const stars = '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating);
        const questionsHtml = questions.length
            ? `<div style="margin:18px 0;">
                 <p style="font-size:14px;font-weight:600;color:#374151;margin-bottom:10px;">Nos gustaría conocer tu opinión sobre los siguientes puntos:</p>
                 <ul style="padding-left:20px;margin:0;">${questions.map(q =>
                   `<li style="font-size:13px;color:#475569;padding:4px 0;">${q}</li>`).join('')}
                 </ul>
               </div>`
            : '';
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        await transporter.sendMail({
            from: `"Service Desk TI" <${process.env.SMTP_USER}>`,
            to: s.email,
            subject: 'Queremos mejorar tu experiencia — Service Desk TI',
            html: `<!DOCTYPE html><html lang="es"><body style="font-family:-apple-system,sans-serif;background:#f4f5f7;padding:32px 16px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="560" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
  <tr><td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:24px 32px;">
    <div style="font-size:18px;font-weight:700;color:#fff;">🎧 Service Desk TI</div>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="font-size:15px;color:#374151;">Hola, <strong>${s.full_name}</strong> 👋</p>
    <p style="font-size:14px;color:#374151;">Notamos que calificaste tu experiencia con <strong style="color:#f59e0b;">${stars} (${s.rating}/5)</strong>${s.comment ? ` con el comentario: "<em>${s.comment}</em>"` : ''}.</p>
    <p style="font-size:14px;color:#374151;">Valoramos mucho tu opinión y queremos entender cómo podemos mejorar tu experiencia con el Service Desk.</p>
    ${questionsHtml}
    <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:14px 16px;border-radius:6px;margin:20px 0;">
      <p style="font-size:13px;color:#1e40af;margin:0;font-weight:600;">¿Desea que nuestro gestor de incidentes se comunique personalmente con usted?</p>
      <p style="font-size:12px;color:#3b82f6;margin:6px 0 0;">Si es así, responda este correo indicando su disponibilidad y nos pondremos en contacto a la brevedad.</p>
    </div>
    <p style="font-size:14px;color:#374151;">Gracias por ayudarnos a mejorar,<br><strong>Equipo de Service Desk TI</strong></p>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:16px 32px;font-size:11px;color:#94a3b8;text-align:center;">
    Este correo fue enviado porque usted realizó una calificación en el Portal de Servicios TI.
  </td></tr>
</table></td></tr></table></body></html>`,
        });
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/portal/recommendation — recomendación/sugerencia ────────────────
router.post('/recommendation', optionalAuth, async (req, res) => {
    try {
        const { text, category } = req.body;
        if (!text) return res.status(400).json({ success: false, error: 'text requerido' });
        await executeQuery(equipmentPool,
            `INSERT INTO portal_recommendations (user_id, category, text, created_at) VALUES (?,?,?,NOW())`,
            [req.user?.id || null, category || 'General', text]
        );
        res.json({ success: true });
    } catch(err) {
        res.json({ success: true });
    }
});

// ── ANUNCIOS CORPORATIVOS (feed social) ──────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_announcements (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                title        VARCHAR(200),
                body         TEXT NOT NULL,
                image_data   MEDIUMTEXT,
                audience     VARCHAR(50) DEFAULT 'todos',
                author_email VARCHAR(255),
                author_name  VARCHAR(200),
                pinned       TINYINT(1) DEFAULT 0,
                active       TINYINT(1) DEFAULT 1,
                created_at   DATETIME DEFAULT NOW(),
                INDEX idx_active (active),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        for (const col of [
            `ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS author_email VARCHAR(255)`,
            `ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS author_name  VARCHAR(200)`,
            `ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS pinned       TINYINT(1) DEFAULT 0`,
            `ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS active       TINYINT(1) DEFAULT 1`,
            `ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS image_data   MEDIUMTEXT`,
        ]) { try { await executeQuery(equipmentPool, col); } catch(e) {} }

        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_post_reactions (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                announcement_id INT NOT NULL,
                email           VARCHAR(255) NOT NULL,
                reaction        ENUM('like','love','clap','insight') DEFAULT 'like',
                created_at      DATETIME DEFAULT NOW(),
                UNIQUE KEY uq_react (announcement_id, email),
                INDEX idx_ann (announcement_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_post_comments (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                announcement_id INT NOT NULL,
                email           VARCHAR(255) NOT NULL,
                author_name     VARCHAR(200),
                body            TEXT NOT NULL,
                created_at      DATETIME DEFAULT NOW(),
                INDEX idx_ann (announcement_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { logger.warn('portal_announcements migration:', e.message); }
})();

// GET /api/portal/announcements/authors — distinct authors for autocomplete
router.get('/announcements/authors', async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT DISTINCT author_email, author_name FROM portal_announcements WHERE active=1 AND author_email IS NOT NULL ORDER BY author_name ASC`
        );
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/portal/announcements
router.get('/announcements', async (req, res) => {
    try {
        const { email = '', page = 1, limit = 20, author = '', q = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const authorFilter = author ? `AND LOWER(a.author_email) = LOWER(?)` : '';
        const qFilter      = q      ? `AND (a.title LIKE ? OR a.body LIKE ? OR a.author_name LIKE ?)` : '';
        const qVal         = q ? `%${q}%` : null;
        const params = [email];
        if (author) params.push(author);
        if (q)      params.push(qVal, qVal, qVal);
        params.push(parseInt(limit), offset);

        const rows = await executeQuery(equipmentPool, `
            SELECT a.*,
                (SELECT COUNT(*) FROM portal_post_reactions  WHERE announcement_id = a.id) AS reaction_count,
                (SELECT COUNT(*) FROM portal_post_comments   WHERE announcement_id = a.id) AS comment_count,
                (SELECT reaction FROM portal_post_reactions  WHERE announcement_id = a.id AND email = ? LIMIT 1) AS my_reaction,
                (SELECT COUNT(*) FROM portal_post_reactions  WHERE announcement_id = a.id AND reaction='like')    AS r_like,
                (SELECT COUNT(*) FROM portal_post_reactions  WHERE announcement_id = a.id AND reaction='love')    AS r_love,
                (SELECT COUNT(*) FROM portal_post_reactions  WHERE announcement_id = a.id AND reaction='clap')    AS r_clap,
                (SELECT COUNT(*) FROM portal_post_reactions  WHERE announcement_id = a.id AND reaction='insight') AS r_insight
            FROM portal_announcements a
            WHERE a.active = 1 ${authorFilter} ${qFilter}
            ORDER BY a.pinned DESC, a.created_at DESC
            LIMIT ? OFFSET ?
        `, params);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/portal/announcements — crear (cualquier usuario identificado)
router.post('/announcements', async (req, res) => {
    try {
        const { body, author_email } = req.body;
        if (!body || !author_email) return res.status(400).json({ success: false, error: 'body y author_email requeridos' });
        const title      = req.body.title      || '';
        const image_data = req.body.image_data || '';
        const audience   = req.body.audience   || 'todos';
        const author_name = req.body.author_name || author_email;
        const emailKey = author_email.toLowerCase().trim();
        await executeQuery(equipmentPool,
            `INSERT INTO portal_announcements (title, body, image_data, audience, author_email, author_name)
             VALUES (NULLIF(?,''), ?, NULLIF(?,''), ?, ?, ?)`,
            [title, body.trim(), image_data, audience, emailKey, author_name.toString()]
        );
        const rows = await executeQuery(equipmentPool,
            `SELECT id, title, body, image_data, audience, author_email, author_name, pinned, created_at
             FROM portal_announcements WHERE author_email = ? ORDER BY id DESC LIMIT 1`,
            [emailKey]
        );
        const post = rows[0] || { title, body: body.trim(), audience, author_email: emailKey, author_name: author_name.toString(), pinned: 0 };
        res.status(201).json({ success: true, data: { ...post, reaction_count:0, comment_count:0, r_like:0, r_love:0, r_clap:0, r_insight:0, my_reaction:null } });
    } catch(err) {
        logger.error('POST /announcements error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/portal/announcements/:id/react — toggle reacción
router.post('/announcements/:id/react', async (req, res) => {
    try {
        const { email, reaction = 'like' } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'email requerido' });
        const cleanEmail = email.toLowerCase();
        const existing = await executeQuery(equipmentPool,
            `SELECT id, reaction FROM portal_post_reactions WHERE announcement_id=? AND email=?`,
            [req.params.id, cleanEmail]
        );
        let action, my_reaction = null;
        if (existing.length) {
            if (existing[0].reaction === reaction) {
                await executeQuery(equipmentPool, `DELETE FROM portal_post_reactions WHERE id=?`, [existing[0].id]);
                action = 'removed';
            } else {
                await executeQuery(equipmentPool, `UPDATE portal_post_reactions SET reaction=? WHERE id=?`, [reaction, existing[0].id]);
                action = 'changed'; my_reaction = reaction;
            }
        } else {
            await executeQuery(equipmentPool,
                `INSERT INTO portal_post_reactions (announcement_id, email, reaction) VALUES (?,?,?)`,
                [req.params.id, cleanEmail, reaction]
            );
            action = 'added'; my_reaction = reaction;
        }
        // Return updated counts so frontend can update in-place
        const counts = await executeQuery(equipmentPool, `
            SELECT
                SUM(reaction='like')    AS r_like,
                SUM(reaction='love')    AS r_love,
                SUM(reaction='clap')    AS r_clap,
                SUM(reaction='insight') AS r_insight
            FROM portal_post_reactions WHERE announcement_id=?`, [req.params.id]);
        res.json({ success: true, action, my_reaction, counts: counts[0] || {} });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/portal/announcements/:id/comments
router.get('/announcements/:id/comments', async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT * FROM portal_post_comments WHERE announcement_id=? ORDER BY created_at ASC`,
            [req.params.id]
        );
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/portal/announcements/:id/comments
router.post('/announcements/:id/comments', async (req, res) => {
    try {
        const { email, author_name, body } = req.body;
        if (!email || !body) return res.status(400).json({ success: false, error: 'email y body requeridos' });
        const r = await executeQuery(equipmentPool,
            `INSERT INTO portal_post_comments (announcement_id, email, author_name, body) VALUES (?,?,?,?)`,
            [req.params.id, email.toLowerCase().trim(), author_name || email, body.trim()]
        );
        res.status(201).json({ success: true, id: r.insertId });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/portal/announcements/:id — desactivar (admin/especialista vía JWT)
router.delete('/announcements/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await executeQuery(equipmentPool, `UPDATE portal_announcements SET active=0 WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── BANNERS / MARQUESINA ─────────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_banners (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                message     VARCHAR(300) NOT NULL,
                severity    ENUM('critical','warning','info','success') DEFAULT 'warning',
                active      TINYINT(1) DEFAULT 1,
                expires_at  DATETIME NULL,
                created_by  INT,
                created_at  DATETIME DEFAULT NOW(),
                INDEX idx_active (active),
                INDEX idx_exp (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        const existing = await executeQuery(equipmentPool, `SELECT COUNT(*) AS n FROM portal_banners`);
        if (existing[0].n === 0) {
            await executeQuery(equipmentPool,
                `INSERT INTO portal_banners (message, severity) VALUES (?,?)`,
                ['✅ Portal de Servicios TI operativo — Todos los sistemas funcionando con normalidad.', 'success']
            );
            logger.info('✅ Banner inicial creado');
        }
    } catch(e) { logger.warn('portal_banners migration:', e.message); }
})();

// GET /api/portal/banners — público (activos) o con ?all=1 para admin
router.get('/banners', async (req, res) => {
    try {
        const showAll = req.query.all === '1';
        let sql = `SELECT id, message, severity, active, expires_at, created_at
                   FROM portal_banners
                   WHERE active = 1 AND (expires_at IS NULL OR expires_at > NOW())
                   ORDER BY created_at DESC`;
        if (showAll) {
            sql = `SELECT id, message, severity, active, expires_at, created_at
                   FROM portal_banners WHERE active = 1 ORDER BY created_at DESC LIMIT 50`;
        }
        const rows = await executeQuery(equipmentPool, sql);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/portal/banners — admin/especialista
router.post('/banners', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { message, severity = 'warning', expires_at } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'message requerido' });
        const r = await executeQuery(equipmentPool,
            `INSERT INTO portal_banners (message, severity, expires_at, created_by) VALUES (?,?,?,?)`,
            [message.trim(), severity, expires_at || null, req.user.id]
        );
        res.status(201).json({ success: true, id: r.insertId });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/portal/banners/:id — desactivar
router.delete('/banners/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await executeQuery(equipmentPool, `UPDATE portal_banners SET active = 0 WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/portal/activity-metrics — solo admin/especialista ───────────────
router.get('/activity-metrics', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });

        const { from, to, email: filterEmail } = req.query;

        let dateClause = '';
        const params = [];
        if (from) { dateClause += ` AND created_at >= ?`; params.push(from + ' 00:00:00'); }
        if (to)   { dateClause += ` AND created_at <= ?`; params.push(to   + ' 23:59:59'); }
        if (filterEmail) { dateClause += ` AND email LIKE ?`; params.push(`%${filterEmail}%`); }

        // Per-user action summary
        const summary = await executeQuery(equipmentPool, `
            SELECT
                email,
                COUNT(*) AS total,
                SUM(action = 'identify')            AS identifies,
                SUM(action = 'incidencia_creada')   AS incidencias,
                SUM(action = 'requerimiento_creado') AS requerimientos,
                MAX(created_at)                     AS last_seen
            FROM portal_activity_log
            WHERE 1=1 ${dateClause}
            GROUP BY email
            ORDER BY last_seen DESC
            LIMIT 200
        `, params);

        // Global totals
        const totals = await executeQuery(equipmentPool, `
            SELECT
                COUNT(DISTINCT email)               AS unique_users,
                COUNT(*)                            AS total_actions,
                SUM(action = 'incidencia_creada')   AS total_incidencias,
                SUM(action = 'requerimiento_creado') AS total_requerimientos,
                SUM(action = 'identify')            AS total_logins
            FROM portal_activity_log
            WHERE 1=1 ${dateClause}
        `, params);

        // Daily activity (last 30 days)
        const daily = await executeQuery(equipmentPool, `
            SELECT DATE(created_at) AS day, COUNT(*) AS n
            FROM portal_activity_log
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) ${filterEmail ? 'AND email LIKE ?' : ''}
            GROUP BY day ORDER BY day
        `, filterEmail ? [`%${filterEmail}%`] : []);

        res.json({ success: true, totals: totals[0], summary, daily });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── WHATSAPP REGISTRATION ─────────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_whatsapp_requests (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                email       VARCHAR(200) NOT NULL,
                name        VARCHAR(200),
                phone       VARCHAR(20) NOT NULL,
                reason      TEXT,
                status      ENUM('pending','approved','rejected') DEFAULT 'pending',
                approved_by VARCHAR(200),
                created_at  DATETIME DEFAULT NOW(),
                approved_at DATETIME,
                UNIQUE KEY uq_wsp_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { logger.error('portal_whatsapp_requests migration:', e.message); }
})();

// POST /api/portal/whatsapp-register — submit request (public)
router.post('/whatsapp-register', async (req, res) => {
    try {
        const { email, name, phone, reason } = req.body;
        if (!email || !phone) return res.status(400).json({ success:false, error:'email y phone requeridos' });
        const phoneClean = phone.replace(/\s/g, '');
        await executeQuery(equipmentPool,
            `INSERT INTO portal_whatsapp_requests (email, name, phone, reason) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE phone=VALUES(phone), name=VALUES(name), reason=VALUES(reason), status='pending', approved_at=NULL`,
            [email.toLowerCase().trim(), (name||email).toString(), phoneClean, reason||'']
        );
        res.status(201).json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// GET /api/portal/whatsapp-requests — list (admin/especialista)
router.get('/whatsapp-requests', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const { status } = req.query;
        const where = status ? 'WHERE status=?' : '';
        const rows = await executeQuery(equipmentPool,
            `SELECT id, email, name, phone, reason, status, approved_by, created_at, approved_at
             FROM portal_whatsapp_requests ${where} ORDER BY created_at DESC LIMIT 200`,
            status ? [status] : []
        );
        res.json({ success:true, data: rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// PUT /api/portal/whatsapp-requests/:id — approve or reject
router.put('/whatsapp-requests/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const { status } = req.body;
        if (!['approved','rejected'].includes(status)) return res.status(400).json({ success:false, error:'status inválido' });
        await executeQuery(equipmentPool,
            `UPDATE portal_whatsapp_requests SET status=?, approved_by=?, approved_at=NOW() WHERE id=?`,
            [status, req.user.email||req.user.full_name||'admin', req.params.id]
        );
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// DELETE /api/portal/whatsapp-requests/:id
router.delete('/whatsapp-requests/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        await executeQuery(equipmentPool, `DELETE FROM portal_whatsapp_requests WHERE id=?`, [req.params.id]);
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// ── AI CHATBOT ────────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
    try {
        const { message, email, name, history = [] } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'message requerido' });

        // 1. Fetch FAQ + approved contributions as context
        const [faqRows, contribRows] = await Promise.all([
            executeQuery(equipmentPool, `SELECT category, question, answer FROM faq_items WHERE active=1 ORDER BY views DESC LIMIT 30`),
            executeQuery(equipmentPool, `SELECT title, body, category FROM portal_knowledge_contributions WHERE status='approved' LIMIT 20`)
        ]);

        const faqContext = faqRows.map(r => `P: ${r.question}\nR: ${r.answer}`).join('\n\n');
        const kbContext  = contribRows.map(r => `[${r.category}] ${r.title}: ${r.body}`).join('\n\n');

        // 2. Build system prompt
        const systemPrompt = `Eres ARIA, la asistente virtual inteligente del portal de autogestión TI de Integratel.
Tu personalidad: profesional, amigable, empática, concisa. Usas emojis con moderación.
Usuario actual: ${name || email || 'usuario'} (${email || ''}).

CAPACIDADES:
- Responder preguntas sobre servicios TI usando la base de conocimiento.
- Guiar al usuario para crear incidencias o requerimientos.
- Explicar estados de tickets, SLA, y procesos.

INTENCIÓN ESPECIAL: Si el usuario quiere crear una incidencia, responde con exactamente este marcador al final: [ACTION:open_incidencia]
Si quiere crear un requerimiento: [ACTION:open_requerimiento]
Si quiere ver sus tickets: [ACTION:open_tickets]
Si quiere ir al FAQ: [ACTION:open_faq]

BASE DE CONOCIMIENTO (FAQ):
${faqContext}

APORTES DE LA COMUNIDAD:
${kbContext}

REGLAS:
- Responde siempre en español.
- Sé breve (máximo 4 oraciones) salvo que pidan detalle.
- Si no tienes información, di que derivarás al equipo TI.
- No inventes información técnica fuera de la base de conocimiento.`;

        // 3. Build message history for Groq
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: message }
        ];

        // 4. Call Groq
        const Groq = require('groq-sdk');
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const completion = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages,
            temperature: 0.55,
            max_tokens: 512
        });

        let reply = completion.choices[0]?.message?.content || 'Lo siento, no pude procesar tu consulta.';

        // 5. Extract action marker
        let action = null;
        const actionMatch = reply.match(/\[ACTION:(\w+)\]/);
        if (actionMatch) { action = actionMatch[1]; reply = reply.replace(/\[ACTION:\w+\]/, '').trim(); }

        res.json({ success: true, reply, action });
    } catch (err) {
        logger.error('POST /chat error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── KNOWLEDGE CONTRIBUTIONS ───────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_knowledge_contributions (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                email        VARCHAR(200) NOT NULL,
                name         VARCHAR(200),
                title        VARCHAR(400) NOT NULL,
                body         TEXT NOT NULL,
                category     VARCHAR(100) DEFAULT 'General',
                status       ENUM('pending','approved','rejected') DEFAULT 'pending',
                approved_by  VARCHAR(200),
                created_at   DATETIME DEFAULT NOW(),
                approved_at  DATETIME
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await executeQuery(equipmentPool, `ALTER TABLE portal_knowledge_contributions ADD COLUMN IF NOT EXISTS admin_response TEXT NULL`).catch(()=>{});
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_contribution_ratings (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                contribution_id INT NOT NULL,
                email           VARCHAR(200) NOT NULL,
                stars           TINYINT NOT NULL,
                created_at      DATETIME DEFAULT NOW(),
                UNIQUE KEY uq_rating (contribution_id, email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { logger.error('portal_contributions migration:', e.message); }
})();

// GET /api/portal/contributions/approved — public (para faq.ejs)
router.get('/contributions/approved', async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT c.id, c.email, c.name, c.title, c.body, c.category, c.approved_at,
                    ROUND(COALESCE(AVG(r.stars),0),1) AS avg_stars, COUNT(r.id) AS rating_count
             FROM portal_knowledge_contributions c
             LEFT JOIN portal_contribution_ratings r ON r.contribution_id = c.id
             WHERE c.status = 'approved'
             GROUP BY c.id ORDER BY c.approved_at DESC LIMIT 50`
        );
        res.json({ success:true, data: rows });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// GET /api/portal/contributions — list all (admin/especialista)
router.get('/contributions', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const { status } = req.query;
        const where = status ? 'WHERE c.status = ?' : '';
        const params = status ? [status] : [];
        const rows = await executeQuery(equipmentPool,
            `SELECT c.id, c.email, c.name, c.title, c.body, c.category, c.status, c.approved_by, c.admin_response, c.created_at,
                    ROUND(COALESCE(AVG(r.stars),0),1) AS avg_stars, COUNT(r.id) AS rating_count
             FROM portal_knowledge_contributions c
             LEFT JOIN portal_contribution_ratings r ON r.contribution_id = c.id
             ${where} GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`,
            params
        );
        res.json({ success:true, data: rows });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// POST /api/portal/contributions — submit (public)
router.post('/contributions', async (req, res) => {
    try {
        const { email, title, body } = req.body;
        if (!email || !title || !body) return res.status(400).json({ success:false, error:'email, title y body requeridos' });
        const name     = req.body.name     || email;
        const category = req.body.category || 'General';
        const r = await executeQuery(equipmentPool,
            `INSERT INTO portal_knowledge_contributions (email, name, title, body, category) VALUES (?, ?, ?, ?, ?)`,
            [email.toLowerCase().trim(), name.toString(), title.trim(), body.trim(), category]
        );
        res.status(201).json({ success:true, data:{ id: r.insertId } });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// PUT /api/portal/contributions/:id — approve or reject (admin/especialista)
router.put('/contributions/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const { status } = req.body;
        if (!['approved','rejected'].includes(status)) return res.status(400).json({ success:false, error:'status inválido' });
        await executeQuery(equipmentPool,
            `UPDATE portal_knowledge_contributions SET status=?, approved_by=?, approved_at=NOW() WHERE id=?`,
            [status, req.user.email||req.user.full_name||'admin', req.params.id]
        );
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// PATCH /api/portal/contributions/:id/response — guardar nota/respuesta admin
router.patch('/contributions/:id/response', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const { response } = req.body;
        if (!response?.trim()) return res.status(400).json({ success:false, error:'Respuesta requerida' });
        await executeQuery(equipmentPool,
            `UPDATE portal_knowledge_contributions SET admin_response = ? WHERE id = ?`,
            [response.trim(), req.params.id]
        );
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// DELETE /api/portal/contributions/:id
router.delete('/contributions/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        await executeQuery(equipmentPool, `DELETE FROM portal_knowledge_contributions WHERE id=?`, [req.params.id]);
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// POST /api/portal/contributions/:id/rate — star rating (public, 1 per email)
router.post('/contributions/:id/rate', async (req, res) => {
    try {
        const { email, stars } = req.body;
        if (!email || !stars || stars < 1 || stars > 5) return res.status(400).json({ success:false, error:'email y stars(1-5) requeridos' });
        await executeQuery(equipmentPool,
            `INSERT INTO portal_contribution_ratings (contribution_id, email, stars) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE stars=VALUES(stars)`,
            [req.params.id, email.toLowerCase().trim(), parseInt(stars)]
        );
        const agg = await executeQuery(equipmentPool,
            `SELECT ROUND(AVG(stars),1) AS avg_stars, COUNT(*) AS rating_count FROM portal_contribution_ratings WHERE contribution_id=?`,
            [req.params.id]
        );
        res.json({ success:true, avg_stars: agg[0].avg_stars, rating_count: agg[0].rating_count });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// ── PORTAL USER QUESTIONS ─────────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_user_questions (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                email        VARCHAR(200) NOT NULL,
                name         VARCHAR(200),
                question     TEXT NOT NULL,
                answer       TEXT,
                category     VARCHAR(100) DEFAULT 'General',
                status       ENUM('pending','answered','published') DEFAULT 'pending',
                answered_by  VARCHAR(200),
                created_at   DATETIME DEFAULT NOW(),
                answered_at  DATETIME
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { logger.error('portal_user_questions migration:', e.message); }
})();

// GET /api/portal/questions — list (admin/especialista JWT)
router.get('/questions', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const { status } = req.query;
        const where = status ? 'WHERE status = ?' : '';
        const params = status ? [status] : [];
        const rows = await executeQuery(equipmentPool,
            `SELECT id, email, name, question, answer, category, status, answered_by, created_at, answered_at
             FROM portal_user_questions ${where} ORDER BY created_at DESC LIMIT 200`,
            params
        );
        res.json({ success:true, data: rows });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// POST /api/portal/questions — submit question (public)
router.post('/questions', async (req, res) => {
    try {
        const { email, question } = req.body;
        if (!email || !question) return res.status(400).json({ success:false, error:'email y question requeridos' });
        const name = req.body.name || email;
        const category = req.body.category || 'General';
        const r = await executeQuery(equipmentPool,
            `INSERT INTO portal_user_questions (email, name, question, category) VALUES (?, ?, ?, ?)`,
            [email.toLowerCase().trim(), name.toString(), question.trim(), category]
        );
        res.status(201).json({ success:true, data:{ id: r.insertId } });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// PUT /api/portal/questions/:id — answer (admin/especialista)
router.put('/questions/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const { answer, category } = req.body;
        if (!answer) return res.status(400).json({ success:false, error:'answer requerido' });
        await executeQuery(equipmentPool,
            `UPDATE portal_user_questions SET answer=?, category=COALESCE(?,category), status='answered', answered_by=?, answered_at=NOW() WHERE id=?`,
            [answer.trim(), category||null, req.user.email||req.user.full_name||'admin', req.params.id]
        );
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// POST /api/portal/questions/:id/publish — publish answered question to faq_items
router.post('/questions/:id/publish', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        const rows = await executeQuery(equipmentPool,
            `SELECT * FROM portal_user_questions WHERE id=?`, [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success:false, error:'No encontrado' });
        const q = rows[0];
        if (!q.answer) return res.status(400).json({ success:false, error:'Debes responder la pregunta antes de publicar' });
        await executeQuery(equipmentPool,
            `INSERT INTO faq_items (category, question, answer, order_num) VALUES (?, ?, ?, 0)`,
            [q.category||'General', q.question, q.answer]
        );
        await executeQuery(equipmentPool,
            `UPDATE portal_user_questions SET status='published' WHERE id=?`, [req.params.id]
        );
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// DELETE /api/portal/questions/:id
router.delete('/questions/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador','especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success:false, error:'Sin permiso' });
        await executeQuery(equipmentPool, `DELETE FROM portal_user_questions WHERE id=?`, [req.params.id]);
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error: err.message }); }
});

// ── DEVOLUCIÓN DE EQUIPOS ────────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_devoluciones (
                id                INT AUTO_INCREMENT PRIMARY KEY,
                employee_id       INT DEFAULT NULL,
                employee_email    VARCHAR(200),
                employee_name     VARCHAR(200),
                equipment_ids     TEXT,
                devolvio_celular  TINYINT(1) DEFAULT 0,
                mantiene_llave    TINYINT(1) DEFAULT 0,
                entrego_fotocheck TINYINT(1) DEFAULT 0,
                firma_digital     LONGTEXT,
                observaciones     TEXT,
                created_at        DATETIME DEFAULT NOW(),
                INDEX idx_email (employee_email),
                INDEX idx_employee (employee_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch(e) {}
})();

// GET /api/portal/devolucion/equipment?email= — equipos asignados por email
router.get('/devolucion/equipment', async (req, res) => {
    try {
        const email = (req.query.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ success: false, error: 'email requerido' });

        const emp = await executeQuery(equipmentPool,
            `SELECT id, full_name, email FROM employees WHERE LOWER(email)=? AND is_active=1 LIMIT 1`,
            [email]
        );
        if (!emp.length) return res.json({ success: true, employeeId: null, equipment: [], message: 'Empleado no encontrado o ya dado de baja' });

        const equipment = await executeQuery(equipmentPool, `
            SELECT eq.id, eq.device_code, eq.brand, eq.model, eq.serial_number,
                   eq.equipment_type, eq.status, a.id AS assignment_id
            FROM assignments a
            INNER JOIN equipment eq ON a.equipment_id = eq.id
            WHERE a.employee_id = ? AND a.return_date IS NULL AND a.status = 'activo'
            ORDER BY eq.equipment_type, eq.brand
        `, [emp[0].id]);

        res.json({ success: true, employeeId: emp[0].id, employeeName: emp[0].full_name, equipment });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Migraciones nuevos campos portal_devoluciones
;(async () => {
    const cols = [
        `ALTER TABLE portal_devoluciones ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pendiente'`,
        `ALTER TABLE portal_devoluciones ADD COLUMN IF NOT EXISTS foto_data LONGTEXT`,
        `ALTER TABLE portal_devoluciones ADD COLUMN IF NOT EXISTS entrego_mochila TINYINT(1) NOT NULL DEFAULT 0`,
    ];
    for (const sql of cols) { try { await executeQuery(equipmentPool, sql); } catch(e) {} }
})();

// POST /api/portal/devolucion — registrar devolución (pendiente de aprobación)
router.post('/devolucion', async (req, res) => {
    try {
        const {
            portalEmail, portalName, employeeId,
            equipmentIds = [],
            devolvio_celular, mantiene_llave, entrego_fotocheck, entrego_mochila,
            firma_digital, foto_data, observaciones,
        } = req.body;

        const email = (portalEmail || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });

        const empRows = await executeQuery(equipmentPool,
            `SELECT id, full_name FROM employees WHERE LOWER(email)=? LIMIT 1`, [email]
        );
        const empId = employeeId || (empRows[0] && empRows[0].id) || null;

        await executeQuery(equipmentPool,
            `INSERT INTO portal_devoluciones
             (employee_id, employee_email, employee_name, equipment_ids,
              devolvio_celular, mantiene_llave, entrego_fotocheck, entrego_mochila,
              firma_digital, foto_data, observaciones, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,'pendiente',NOW())`,
            [
                empId,
                email,
                (portalName || (empRows[0] && empRows[0].full_name) || '').toString(),
                JSON.stringify(equipmentIds),
                devolvio_celular  ? 1 : 0,
                mantiene_llave    ? 1 : 0,
                entrego_fotocheck ? 1 : 0,
                entrego_mochila   ? 1 : 0,
                firma_digital || null,
                foto_data     || null,
                observaciones || null,
            ]
        );

        res.json({ success: true, message: 'Devolución registrada. Pendiente de aprobación por TI.' });
    } catch(err) {
        logger.error('POST /devolucion error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/portal/devoluciones — listar para admin/especialista
router.get('/devoluciones', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista', 'agente', 'tecnico'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { status = '' } = req.query;
        const rows = await executeQuery(equipmentPool,
            `SELECT id, employee_id, employee_email, employee_name, equipment_ids,
                    devolvio_celular, mantiene_llave, entrego_fotocheck, entrego_mochila,
                    firma_digital, foto_data, observaciones, status, created_at
             FROM portal_devoluciones
             ${status ? 'WHERE status=?' : ''}
             ORDER BY created_at DESC LIMIT 100`,
            status ? [status] : []
        );
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/portal/devoluciones/:id — aprobar / rechazar
router.put('/devoluciones/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { status } = req.body;
        if (!['pendiente', 'aprobado', 'rechazado'].includes(status))
            return res.status(400).json({ success: false, error: 'Status invalido' });

        await executeQuery(equipmentPool, `UPDATE portal_devoluciones SET status=? WHERE id=?`, [status, req.params.id]);

        if (status === 'aprobado') {
            const rows = await executeQuery(equipmentPool, `SELECT * FROM portal_devoluciones WHERE id=?`, [req.params.id]);
            const dev = rows[0];
            if (dev && dev.employee_id) {
                const empId = dev.employee_id;
                await executeQuery(equipmentPool,
                    `UPDATE employees SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [empId]
                ).catch(() => {});
                try {
                    const assignments = await executeQuery(equipmentPool,
                        `SELECT a.id AS assignment_id, a.equipment_id FROM assignments a
                         WHERE a.employee_id=? AND a.return_date IS NULL AND a.status='activo'`, [empId]);

                    if (assignments.length) {
                        // Batch-check existing recoveries in one query to avoid N+1
                        const equipIds = assignments.map(a => a.equipment_id);
                        const existingRecs = await executeQuery(equipmentPool,
                            `SELECT equipment_id FROM equipment_recoveries
                             WHERE equipment_id IN (${equipIds.map(() => '?').join(',')}) AND status!='recuperado'`,
                            equipIds);
                        const alreadyPending = new Set(existingRecs.map(r => r.equipment_id));

                        for (const asgn of assignments) {
                            if (alreadyPending.has(asgn.equipment_id)) continue;
                            const rec = await executeQuery(equipmentPool,
                                `INSERT INTO equipment_recoveries (assignment_id,equipment_id,employee_id,recovery_method,notes)
                                 VALUES (?,?,?,'pendiente','Aprobado desde portal de devolucion')`,
                                [asgn.assignment_id, asgn.equipment_id, empId]);
                            await executeQuery(equipmentPool,
                                `INSERT INTO equipment_recovery_logs (recovery_id,new_status,note) VALUES (?,'por_recuperar','Devolucion aprobada en portal')`,
                                [rec.insertId]).catch(() => {});
                        }
                    }
                    await executeQuery(equipmentPool,
                        `UPDATE equipment eq INNER JOIN assignments a ON a.equipment_id=eq.id
                         SET eq.status='En Mantenimiento'
                         WHERE a.employee_id=? AND a.status='activo' AND eq.status='Asignado'`, [empId]).catch(() => {});
                } catch(spErr) { logger.warn('devolucion approve:', spErr.message); }
            }
        }
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GARANTÍAS ────────────────────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_garantias (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                employee_id      INT DEFAULT NULL,
                employee_email   VARCHAR(200),
                employee_name    VARCHAR(200),
                equipment_id     INT DEFAULT NULL,
                equipment_name   VARCHAR(200),
                tipo             VARCHAR(20) NOT NULL DEFAULT 'tecnica',
                pieza            VARCHAR(100),
                descripcion      TEXT,
                urgencia         VARCHAR(20) DEFAULT 'normal',
                cuando_ocurrio   DATE DEFAULT NULL,
                donde_ocurrio    TEXT,
                hora_ocurrio     VARCHAR(10),
                denuncia_data    LONGTEXT,
                firma_digital    LONGTEXT,
                foto_data        LONGTEXT,
                status           VARCHAR(20) NOT NULL DEFAULT 'pendiente',
                created_at       DATETIME DEFAULT NOW(),
                INDEX idx_email (employee_email),
                INDEX idx_employee (employee_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch(e) {}
})();

// POST /api/portal/garantia — registrar solicitud de garantía
router.post('/garantia', async (req, res) => {
    try {
        const {
            portalEmail, portalName, employeeId, equipmentId, equipmentName,
            tipo = 'tecnica', pieza, descripcion, urgencia,
            cuando_ocurrio, donde_ocurrio, hora_ocurrio,
            denuncia_data, firma_digital, foto_data,
        } = req.body;

        const email = (portalEmail || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ success: false, error: 'Email requerido' });

        const empRows = await executeQuery(equipmentPool,
            `SELECT id, full_name FROM employees WHERE LOWER(email)=? LIMIT 1`, [email]
        );
        const empId = employeeId || (empRows[0] && empRows[0].id) || null;
        const empName = (portalName || (empRows[0] && empRows[0].full_name) || '').toString();

        await executeQuery(equipmentPool,
            `INSERT INTO portal_garantias
             (employee_id, employee_email, employee_name, equipment_id, equipment_name,
              tipo, pieza, descripcion, urgencia,
              cuando_ocurrio, donde_ocurrio, hora_ocurrio,
              denuncia_data, firma_digital, foto_data, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pendiente',NOW())`,
            [
                empId, email, empName,
                equipmentId || null,
                equipmentName || null,
                tipo,
                pieza || null,
                descripcion || null,
                urgencia || 'normal',
                cuando_ocurrio || null,
                donde_ocurrio || null,
                hora_ocurrio || null,
                denuncia_data || null,
                firma_digital || null,
                foto_data || null,
            ]
        );

        res.json({ success: true, message: tipo === 'robo' ? 'Incidencia registrada. Pendiente de revisión.' : 'Solicitud de garantía registrada. Pendiente de aprobación.' });
    } catch(err) {
        logger.error('POST /garantia error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/portal/garantias — listar para admin/especialista
router.get('/garantias', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista', 'agente', 'tecnico'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { status = '', tipo = '' } = req.query;
        const conditions = [];
        const params = [];
        if (status) { conditions.push('status=?'); params.push(status); }
        if (tipo)   { conditions.push('tipo=?');   params.push(tipo); }
        const where = conditions.length ? 'WHERE '+conditions.join(' AND ') : '';
        const rows = await executeQuery(equipmentPool,
            `SELECT id, employee_id, employee_email, employee_name, equipment_id, equipment_name,
                    tipo, pieza, descripcion, urgencia,
                    cuando_ocurrio, donde_ocurrio, hora_ocurrio,
                    denuncia_data, firma_digital, foto_data, status, created_at
             FROM portal_garantias ${where}
             ORDER BY created_at DESC LIMIT 100`,
            params
        );
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/portal/garantias/:id — aprobar / rechazar
router.put('/garantias/:id', authenticateToken, async (req, res) => {
    try {
        const allowed = ['administrador', 'especialista'];
        if (!allowed.includes(req.user?.role)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { status } = req.body;
        if (!['pendiente', 'aprobado', 'rechazado'].includes(status))
            return res.status(400).json({ success: false, error: 'Status inválido' });
        await executeQuery(equipmentPool, `UPDATE portal_garantias SET status=? WHERE id=?`, [status, req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── COMUNIDADES & SOLICITUDES ────────────────────────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_communities (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                nombre       VARCHAR(200) NOT NULL,
                descripcion  TEXT,
                created_by   VARCHAR(255),
                created_name VARCHAR(200),
                active       TINYINT(1) DEFAULT 1,
                created_at   DATETIME DEFAULT NOW(),
                INDEX idx_active (active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_community_members (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                community_id INT NOT NULL,
                email        VARCHAR(255) NOT NULL,
                name         VARCHAR(200),
                role         ENUM('admin','member') DEFAULT 'member',
                joined_at    DATETIME DEFAULT NOW(),
                UNIQUE KEY uq_member (community_id, email),
                INDEX idx_comm (community_id),
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS portal_join_requests (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                community_id INT NOT NULL,
                email        VARCHAR(255) NOT NULL,
                name         VARCHAR(200),
                status       ENUM('pending','accepted','rejected') DEFAULT 'pending',
                invited_by   VARCHAR(255),
                created_at   DATETIME DEFAULT NOW(),
                updated_at   DATETIME DEFAULT NOW(),
                UNIQUE KEY uq_req (community_id, email),
                INDEX idx_comm (community_id),
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { logger.warn('portal_communities migration:', e.message); }
})();

// GET /api/portal/communities?email=
router.get('/communities', async (req, res) => {
    const { email = '' } = req.query;
    try {
        const rows = await executeQuery(equipmentPool, `
            SELECT c.*,
                (SELECT COUNT(*) FROM portal_community_members WHERE community_id=c.id) AS member_count,
                (SELECT role FROM portal_community_members WHERE community_id=c.id AND LOWER(email)=LOWER(?) LIMIT 1) AS my_role,
                (SELECT status FROM portal_join_requests WHERE community_id=c.id AND LOWER(email)=LOWER(?) AND status='pending' LIMIT 1) AS pending_request
            FROM portal_communities c WHERE c.active=1 ORDER BY c.created_at DESC
        `, [email, email]);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/portal/communities
router.post('/communities', async (req, res) => {
    const { nombre, descripcion, email, name } = req.body;
    if (!nombre || !email) return res.status(400).json({ success: false, error: 'nombre y email requeridos' });
    try {
        const r = await executeQuery(equipmentPool,
            `INSERT INTO portal_communities (nombre, descripcion, created_by, created_name) VALUES (?,?,?,?)`,
            [nombre.trim(), (descripcion || '').trim(), email.toLowerCase(), name || email]
        );
        await executeQuery(equipmentPool,
            `INSERT INTO portal_community_members (community_id, email, name, role) VALUES (?,?,?,'admin')`,
            [r.insertId, email.toLowerCase(), name || email]
        );
        res.status(201).json({ success: true, id: r.insertId });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/portal/communities/:id/join
router.post('/communities/:id/join', async (req, res) => {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'email requerido' });
    try {
        await executeQuery(equipmentPool,
            `INSERT INTO portal_join_requests (community_id, email, name) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE status='pending', updated_at=NOW()`,
            [req.params.id, email.toLowerCase(), name || email]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/portal/communities/:id/invite
router.post('/communities/:id/invite', async (req, res) => {
    const { inviter_email, target_email, target_name } = req.body;
    if (!inviter_email || !target_email) return res.status(400).json({ success: false, error: 'inviter_email y target_email requeridos' });
    try {
        const member = await executeQuery(equipmentPool,
            `SELECT id FROM portal_community_members WHERE community_id=? AND LOWER(email)=LOWER(?)`,
            [req.params.id, inviter_email]
        );
        if (!member.length) return res.status(403).json({ success: false, error: 'Solo miembros pueden invitar' });
        await executeQuery(equipmentPool,
            `INSERT INTO portal_join_requests (community_id, email, name, invited_by) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE status='pending', updated_at=NOW()`,
            [req.params.id, target_email.toLowerCase(), target_name || target_email, inviter_email.toLowerCase()]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/portal/communities/:id/feed?email=
router.get('/communities/:id/feed', async (req, res) => {
    const { email = '' } = req.query;
    try {
        const member = email ? await executeQuery(equipmentPool,
            `SELECT id FROM portal_community_members WHERE community_id=? AND LOWER(email)=LOWER(?)`,
            [req.params.id, email]
        ) : [];
        if (!member.length) return res.status(403).json({ success: false, error: 'Solo miembros pueden ver el feed' });
        const rows = await executeQuery(equipmentPool, `
            SELECT a.*,
                (SELECT COUNT(*) FROM portal_post_reactions WHERE announcement_id=a.id) AS reaction_count,
                (SELECT COUNT(*) FROM portal_post_comments  WHERE announcement_id=a.id) AS comment_count,
                (SELECT reaction FROM portal_post_reactions WHERE announcement_id=a.id AND LOWER(email)=LOWER(?) LIMIT 1) AS my_reaction,
                (SELECT COUNT(*) FROM portal_post_reactions WHERE announcement_id=a.id AND reaction='like')    AS r_like,
                (SELECT COUNT(*) FROM portal_post_reactions WHERE announcement_id=a.id AND reaction='love')    AS r_love,
                (SELECT COUNT(*) FROM portal_post_reactions WHERE announcement_id=a.id AND reaction='clap')    AS r_clap,
                (SELECT COUNT(*) FROM portal_post_reactions WHERE announcement_id=a.id AND reaction='insight') AS r_insight
            FROM portal_announcements a
            WHERE a.active=1
              AND LOWER(a.author_email) IN (SELECT LOWER(email) FROM portal_community_members WHERE community_id=?)
            ORDER BY a.created_at DESC LIMIT 30
        `, [email, req.params.id]);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/portal/solicitudes/received?email=
router.get('/solicitudes/received', async (req, res) => {
    const { email = '' } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'email requerido' });
    try {
        const rows = await executeQuery(equipmentPool, `
            SELECT jr.*, c.nombre AS community_name
            FROM portal_join_requests jr
            JOIN portal_communities c ON c.id = jr.community_id
            WHERE jr.status='pending'
              AND jr.community_id IN (
                  SELECT community_id FROM portal_community_members WHERE LOWER(email)=LOWER(?) AND role='admin'
              )
            ORDER BY jr.created_at DESC
        `, [email]);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/portal/solicitudes/sent?email=
router.get('/solicitudes/sent', async (req, res) => {
    const { email = '' } = req.query;
    if (!email) return res.status(400).json({ success: false, error: 'email requerido' });
    try {
        const rows = await executeQuery(equipmentPool, `
            SELECT jr.*, c.nombre AS community_name
            FROM portal_join_requests jr
            JOIN portal_communities c ON c.id = jr.community_id
            WHERE LOWER(jr.email)=LOWER(?)
            ORDER BY jr.created_at DESC
        `, [email]);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/portal/solicitudes/:id/accept
router.put('/solicitudes/:id/accept', async (req, res) => {
    const { admin_email } = req.body;
    if (!admin_email) return res.status(400).json({ success: false, error: 'admin_email requerido' });
    try {
        const reqs = await executeQuery(equipmentPool, `SELECT * FROM portal_join_requests WHERE id=?`, [req.params.id]);
        if (!reqs.length) return res.status(404).json({ success: false, error: 'No encontrado' });
        const jr = reqs[0];
        const admin = await executeQuery(equipmentPool,
            `SELECT id FROM portal_community_members WHERE community_id=? AND LOWER(email)=LOWER(?) AND role='admin'`,
            [jr.community_id, admin_email]
        );
        if (!admin.length) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await executeQuery(equipmentPool,
            `UPDATE portal_join_requests SET status='accepted', updated_at=NOW() WHERE id=?`, [req.params.id]
        );
        await executeQuery(equipmentPool,
            `INSERT INTO portal_community_members (community_id, email, name, role) VALUES (?,?,?,'member')
             ON DUPLICATE KEY UPDATE role='member'`,
            [jr.community_id, jr.email, jr.name || jr.email]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/portal/solicitudes/:id/reject
router.put('/solicitudes/:id/reject', async (req, res) => {
    const { admin_email } = req.body;
    if (!admin_email) return res.status(400).json({ success: false, error: 'admin_email requerido' });
    try {
        const reqs = await executeQuery(equipmentPool, `SELECT * FROM portal_join_requests WHERE id=?`, [req.params.id]);
        if (!reqs.length) return res.status(404).json({ success: false, error: 'No encontrado' });
        const jr = reqs[0];
        const admin = await executeQuery(equipmentPool,
            `SELECT id FROM portal_community_members WHERE community_id=? AND LOWER(email)=LOWER(?) AND role='admin'`,
            [jr.community_id, admin_email]
        );
        if (!admin.length) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await executeQuery(equipmentPool,
            `UPDATE portal_join_requests SET status='rejected', updated_at=NOW() WHERE id=?`, [req.params.id]
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
