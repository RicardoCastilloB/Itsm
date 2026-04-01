// routes/knowledge-base.js — Base de Conocimiento
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }    = require('uuid');
const { KbArticle, KbCategory } = require('../src/models');
const { authenticateToken } = require('../middleware/auth');
const sequelize = require('../src/config/database');
const { QueryTypes, Op } = require('sequelize');

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
        const [rows] = await sequelize.query(`
            SELECT query, COUNT(*) AS searches, SUM(results = 0) AS sin_resultado
            FROM kb_search_log
            GROUP BY query
            HAVING sin_resultado > 0
            ORDER BY searches DESC
            LIMIT 20
        `, { type: QueryTypes.SELECT });
        res.json({ success: true, data: rows });
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

module.exports = router;
