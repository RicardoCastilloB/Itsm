// routes/knowledge-base.js — Base de Conocimiento
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }    = require('uuid');
const { KbArticle, KbCategory } = require('../src/models');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const sequelize = require('../src/config/database');
const { QueryTypes, Op } = require('sequelize');

// ── Migración automática de tablas ───────────────────────────────────────────
;(async () => {
    try {
        await sequelize.query(`CREATE TABLE IF NOT EXISTS kb_search_log (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            query      VARCHAR(500) NOT NULL,
            results    INT DEFAULT 0,
            user_id    VARCHAR(100),
            created_at DATETIME DEFAULT NOW(),
            INDEX idx_query   (query(100)),
            INDEX idx_results (results)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, { type: QueryTypes.RAW });

        await sequelize.query(`CREATE TABLE IF NOT EXISTS kb_procedures (
            id                 INT AUTO_INCREMENT PRIMARY KEY,
            title              VARCHAR(300) NOT NULL,
            description        TEXT,
            procedure_category VARCHAR(100) DEFAULT 'general',
            content_type       ENUM('text','pdf','image','ppt') DEFAULT 'text',
            content_data       LONGTEXT,
            file_name          VARCHAR(255),
            created_by         VARCHAR(200),
            created_at         DATETIME DEFAULT NOW(),
            updated_at         DATETIME DEFAULT NOW() ON UPDATE NOW(),
            active             TINYINT(1) DEFAULT 1,
            sort_order         INT DEFAULT 0,
            INDEX idx_cat    (procedure_category),
            INDEX idx_active (active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, { type: QueryTypes.RAW });

        await sequelize.query(`CREATE TABLE IF NOT EXISTS kb_procedure_requests (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            user_id     VARCHAR(100),
            user_name   VARCHAR(200),
            user_email  VARCHAR(200),
            query       VARCHAR(500) NOT NULL,
            description TEXT,
            status      ENUM('pendiente','en_progreso','resuelto') DEFAULT 'pendiente',
            created_at  DATETIME DEFAULT NOW(),
            resolved_at DATETIME NULL,
            INDEX idx_status  (status),
            INDEX idx_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, { type: QueryTypes.RAW });
    } catch(e) { console.warn('KB migration:', e.message); }
})();

// ── helpers ───────────────────────────────────────────────────────────────────
const ADMIN_ROLES = ['administrador', 'especialista'];
function isAdmin(user) { return ADMIN_ROLES.includes(user?.role); }

// GET /api/kb/categories
router.get('/categories', authenticateToken, async (req, res) => {
    try {
        const cats = await KbCategory.findAll({
            order: [['sortOrder', 'ASC'], ['name', 'ASC']],
            include: [{ model: KbArticle, as: 'articulos',
                where: { status: 'publicado', deletedAt: null }, required: false }],
        });
        res.json({ success: true, data: cats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/kb/search?q=...
router.get('/search', authenticateToken, async (req, res) => {
    try {
        const { q = '', limit = 10 } = req.query;

        // Log de búsqueda
        if (q.trim()) {
            const results = await KbArticle.count({ where: {
                status: 'publicado', deletedAt: null,
                [Op.or]: [
                    { title:   { [Op.like]: `%${q}%` } },
                    { content: { [Op.like]: `%${q}%` } },
                    { tags:    { [Op.like]: `%${q}%` } },
                ],
            }});
            await sequelize.query(
                'INSERT INTO kb_search_log (query, results, user_id) VALUES (?, ?, ?)',
                { replacements: [q.trim(), results, req.user.id], type: QueryTypes.INSERT }
            );
        }

        const articles = await KbArticle.findAll({
            where: {
                status: 'publicado', deletedAt: null,
                [Op.or]: [
                    { title:   { [Op.like]: `%${q}%` } },
                    { content: { [Op.like]: `%${q}%` } },
                    { tags:    { [Op.like]: `%${q}%` } },
                ],
            },
            include: [{ model: KbCategory, as: 'categoria' }],
            order: [['views', 'DESC']],
            limit: parseInt(limit),
        });
        res.json({ success: true, data: articles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/kb/popular
router.get('/popular', authenticateToken, async (req, res) => {
    try {
        const articles = await KbArticle.findAll({
            where: { status: 'publicado', deletedAt: null },
            order: [['views', 'DESC']],
            limit: 5,
            include: [{ model: KbCategory, as: 'categoria' }],
        });
        res.json({ success: true, data: articles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/kb/suggest?q=...&ticketId=...
// Sugerencias automáticas cuando el usuario escribe el título de un ticket
router.get('/suggest', authenticateToken, async (req, res) => {
    try {
        const { q = '' } = req.query;
        if (!q.trim()) return res.json({ success: true, data: [] });
        const articles = await KbArticle.findAll({
            where: {
                status: 'publicado', deletedAt: null,
                [Op.or]: [
                    { title: { [Op.like]: `%${q}%` } },
                    { tags:  { [Op.like]: `%${q}%` } },
                ],
            },
            limit: 5,
            attributes: ['id', 'title', 'excerpt', 'views'],
        });
        res.json({ success: true, data: articles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/kb/no-results — búsquedas sin resultado (para guiar nuevos artículos)
router.get('/no-results', authenticateToken, async (req, res) => {
    try {
        const rows = await sequelize.query(`
            SELECT query, COUNT(*) AS searches, SUM(results = 0) AS sin_resultado
            FROM kb_search_log
            GROUP BY query
            HAVING sin_resultado > 0
            ORDER BY searches DESC
            LIMIT 20
        `, { type: QueryTypes.SELECT });
        res.json({ success: true, data: rows || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/kb  (lista)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { categoryId, status = 'publicado', page = 1, limit = 20 } = req.query;
        const where = { deletedAt: null };
        if (status)     where.status     = status;
        if (categoryId) where.kbCategoryId = categoryId;

        const { count, rows } = await KbArticle.findAndCountAll({
            where,
            include: [{ model: KbCategory, as: 'categoria' }],
            order: [['views', 'DESC'], ['createdAt', 'DESC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
        });
        res.json({ success: true, data: rows, total: count, page: parseInt(page) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/kb/procedures — must be before /:id
router.get('/procedures', authenticateToken, async (req, res) => {
    try {
        const { category = '' } = req.query;
        const where  = category ? 'WHERE procedure_category = ? AND active = 1' : 'WHERE active = 1';
        const params = category ? [category] : [];
        const rows = await sequelize.query(
            `SELECT id, title, description, procedure_category, content_type, file_name, created_by, created_at
             FROM kb_procedures ${where} ORDER BY sort_order ASC, created_at DESC`,
            { replacements: params, type: QueryTypes.SELECT }
        );
        res.json({ success: true, data: rows || [] });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/kb/procedure-requests — must be before /:id
router.get('/procedure-requests', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const rows = await sequelize.query(
            `SELECT * FROM kb_procedure_requests ORDER BY created_at DESC LIMIT 200`,
            { type: QueryTypes.SELECT }
        );
        res.json({ success: true, data: rows || [] });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/kb/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const article = await KbArticle.findOne({
            where: { id: req.params.id, deletedAt: null },
            include: [{ model: KbCategory, as: 'categoria' }],
        });
        if (!article) return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
        await article.increment('views');
        res.json({ success: true, data: article });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/kb
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, content, kbCategoryId, tags, status, excerpt } = req.body;
        if (!title || !content) return res.status(400).json({ success: false, error: 'Título y contenido requeridos' });
        const article = await KbArticle.create({
            id: uuidv4(),
            authorId: req.user.id,
            title, content, kbCategoryId, tags, status: status || 'borrador',
            excerpt: excerpt || content.replace(/<[^>]+>/g, '').substring(0, 200),
        });
        res.status(201).json({ success: true, data: article });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/kb/:id
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        const article = await KbArticle.findOne({ where: { id: req.params.id, deletedAt: null } });
        if (!article) return res.status(404).json({ success: false, error: 'Artículo no encontrado' });

        const allowed = ['title','content','kbCategoryId','tags','status','excerpt'];
        const updates = {};
        for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
        await article.update(updates);
        res.json({ success: true, data: article });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/kb/:id/helpful
router.post('/:id/helpful', authenticateToken, async (req, res) => {
    try {
        const { vote } = req.body; // 'yes' | 'no'
        const article = await KbArticle.findOne({ where: { id: req.params.id, deletedAt: null } });
        if (!article) return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
        if (vote === 'yes') await article.increment('helpfulYes');
        else                await article.increment('helpfulNo');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/kb/:id/link-ticket
router.post('/:id/link-ticket', authenticateToken, async (req, res) => {
    try {
        const { ticketId } = req.body;
        if (!ticketId) return res.status(400).json({ success: false, error: 'ticketId requerido' });
        await sequelize.query(
            'INSERT IGNORE INTO kb_article_tickets (article_id, ticket_id, linked_by) VALUES (?,?,?)',
            { replacements: [req.params.id, ticketId, req.user.id], type: QueryTypes.INSERT }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/kb/:id
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const article = await KbArticle.findOne({ where: { id: req.params.id, deletedAt: null } });
        if (!article) return res.status(404).json({ success: false, error: 'Artículo no encontrado' });
        await article.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PROCEDIMIENTOS
// ============================================================================

// GET /procedures is registered before /:id above

// GET /api/kb/procedures/:id — incluye content_data
router.get('/procedures/:id', authenticateToken, async (req, res) => {
    try {
        const rows = await sequelize.query(
            `SELECT * FROM kb_procedures WHERE id = ? AND active = 1`,
            { replacements: [req.params.id], type: QueryTypes.SELECT }
        );
        if (!rows?.length) return res.status(404).json({ success: false, error: 'No encontrado' });
        res.json({ success: true, data: rows[0] });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/kb/procedures — solo admin
router.post('/procedures', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { title, description = '', procedure_category = 'general', content_type = 'text', content_data = '', file_name = '' } = req.body;
        if (!title?.trim()) return res.status(400).json({ success: false, error: 'Título requerido' });
        const createdBy = req.user.full_name || req.user.nombre || req.user.username || '';
        await sequelize.query(
            `INSERT INTO kb_procedures (title, description, procedure_category, content_type, content_data, file_name, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            { replacements: [title.trim(), description, procedure_category, content_type, content_data, file_name, createdBy], type: QueryTypes.INSERT }
        );
        res.status(201).json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/kb/procedures/:id — soft delete, solo admin
router.delete('/procedures/:id', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        await sequelize.query(
            `UPDATE kb_procedures SET active = 0 WHERE id = ?`,
            { replacements: [req.params.id], type: QueryTypes.UPDATE }
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================================
// SOLICITUDES DE PROCEDIMIENTO
// ============================================================================

// POST /api/kb/procedure-requests — portal or authenticated user requests a procedure
router.post('/procedure-requests', optionalAuth, async (req, res) => {
    try {
        const { query, description = '' } = req.body;
        if (!query?.trim()) return res.status(400).json({ success: false, error: 'Descripción requerida' });
        // Portal identity from client body takes priority over JWT user
        const userName  = (req.body.user_name  || (req.user && (req.user.full_name || req.user.nombre || req.user.username)) || '').toString();
        const userEmail = (req.body.user_email || (req.user && req.user.email) || '').toString();
        const userId    = req.user ? req.user.id : null;
        await sequelize.query(
            `INSERT INTO kb_procedure_requests (user_id, user_name, user_email, query, description)
             VALUES (?, ?, ?, ?, ?)`,
            { replacements: [userId, userName, userEmail, query.trim(), description], type: QueryTypes.INSERT }
        );
        res.json({ success: true, message: 'Solicitud enviada correctamente' });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /procedure-requests is registered before /:id above

// PATCH /api/kb/procedure-requests/:id/status
router.patch('/procedure-requests/:id/status', authenticateToken, async (req, res) => {
    try {
        if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: 'Sin permiso' });
        const { status } = req.body;
        if (!['pendiente','en_progreso','resuelto'].includes(status))
            return res.status(400).json({ success: false, error: 'Estado inválido' });
        const resolved = status === 'resuelto' ? 'NOW()' : 'NULL';
        await sequelize.query(
            `UPDATE kb_procedure_requests SET status = ?, resolved_at = ${resolved} WHERE id = ?`,
            { replacements: [status, req.params.id], type: QueryTypes.UPDATE }
        );
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
