// ============================================================
// routes/report-lists.js
// CRUD para listas de distribución + contactos de reportes
//
// REGISTRO EN app.js:
//   const reportListsRouter = require('./routes/report-lists');
//   app.use('/api/report-lists', reportListsRouter);
//
// RUTA DE VISTA en routes/views.js:
//   router.get('/report-lists', authenticateToken, (req, res) =>
//     res.render('report-lists', { title: 'Listas de Distribución', user: req.user })
//   );
// ============================================================

const express = require('express');
const router  = express.Router();
const { executeQuery: execQuery, equipmentPool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════
// LISTAS DE DISTRIBUCIÓN
// ═══════════════════════════════════════════════════════════

// GET /api/report-lists — todas las listas con conteo de miembros
router.get('/', authenticateToken, async (req, res) => {
    try {
        const lists = await execQuery(equipmentPool, `
            SELECT
                l.*,
                COUNT(lc.contact_id) AS member_count
            FROM report_distribution_lists l
            LEFT JOIN report_list_contacts lc ON lc.list_id = l.id
            GROUP BY l.id
            ORDER BY l.name ASC
        `);
        res.json({ success: true, data: lists });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/report-lists/:id/contacts — contactos de una lista específica
router.get('/:id/contacts', authenticateToken, async (req, res) => {
    try {
        const contacts = await execQuery(equipmentPool, `
            SELECT c.id, c.name, c.email, c.is_active, lc.added_at
            FROM report_contacts c
            INNER JOIN report_list_contacts lc ON lc.contact_id = c.id
            WHERE lc.list_id = ?
            ORDER BY c.name ASC
        `, [req.params.id]);
        res.json({ success: true, data: contacts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/report-lists — crear nueva lista
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, description, color, icon } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'El nombre es requerido' });

        const slug = name.trim()
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .substring(0, 60);

        const result = await execQuery(equipmentPool, `
            INSERT INTO report_distribution_lists (name, slug, description, color, icon)
            VALUES (?, ?, ?, ?, ?)
        `, [
            name.trim(),
            slug + '_' + Date.now().toString().slice(-4), // evitar colisión de slug
            description?.trim() || null,
            color || '#3b82f6',
            icon  || 'bi-people'
        ]);

        res.status(201).json({ success: true, id: result.insertId, message: 'Lista creada' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/report-lists/:id — editar lista
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, description, color, icon, is_active } = req.body;
        await execQuery(equipmentPool, `
            UPDATE report_distribution_lists
            SET name=?, description=?, color=?, icon=?, is_active=?, updated_at=NOW()
            WHERE id=?
        `, [
            name?.trim(),
            description?.trim() || null,
            color || '#3b82f6',
            icon  || 'bi-people',
            is_active !== undefined ? (is_active ? 1 : 0) : 1,
            req.params.id
        ]);
        res.json({ success: true, message: 'Lista actualizada' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/report-lists/:id — eliminar lista (cascade borra pivote)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        await execQuery(equipmentPool,
            'DELETE FROM report_distribution_lists WHERE id=?', [req.params.id]);
        res.json({ success: true, message: 'Lista eliminada' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/report-lists/:id/contacts/:contactId — añadir contacto a lista
router.post('/:id/contacts/:contactId', authenticateToken, async (req, res) => {
    try {
        await execQuery(equipmentPool,
            'INSERT IGNORE INTO report_list_contacts (list_id, contact_id) VALUES (?,?)',
            [req.params.id, req.params.contactId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/report-lists/:id/contacts/:contactId — quitar contacto de lista
router.delete('/:id/contacts/:contactId', authenticateToken, async (req, res) => {
    try {
        await execQuery(equipmentPool,
            'DELETE FROM report_list_contacts WHERE list_id=? AND contact_id=?',
            [req.params.id, req.params.contactId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// CONTACTOS
// ═══════════════════════════════════════════════════════════

// GET /api/report-lists/contacts/all — todos los contactos con sus listas
router.get('/contacts/all', authenticateToken, async (req, res) => {
    try {
        const { q, list_id } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (q) {
            where += ' AND (c.name LIKE ? OR c.email LIKE ?)';
            params.push(`%${q}%`, `%${q}%`);
        }
        if (list_id) {
            where += ' AND lc2.list_id = ?';
            params.push(list_id);
        }

        const contacts = await execQuery(equipmentPool, `
            SELECT
                c.id, c.name, c.email, c.is_active, c.created_at,
                GROUP_CONCAT(DISTINCT l.name ORDER BY l.name SEPARATOR ', ') AS lists,
                GROUP_CONCAT(DISTINCT l.id   ORDER BY l.id   SEPARATOR ',')  AS list_ids
            FROM report_contacts c
            LEFT JOIN report_list_contacts lc ON lc.contact_id = c.id
            LEFT JOIN report_distribution_lists l ON l.id = lc.list_id
            ${list_id ? 'INNER JOIN report_list_contacts lc2 ON lc2.contact_id = c.id' : ''}
            ${where}
            GROUP BY c.id, c.name, c.email, c.is_active, c.created_at
            ORDER BY c.name ASC
            LIMIT 200
        `, params);

        res.json({ success: true, data: contacts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/report-lists/contacts/search — búsqueda rápida para autocomplete
router.get('/contacts/search', authenticateToken, async (req, res) => {
    try {
        const q = req.query.q || '';
        if (q.length < 2) return res.json({ success: true, data: [] });

        const results = await execQuery(equipmentPool, `
            SELECT id, name, email
            FROM report_contacts
            WHERE is_active = 1 AND (name LIKE ? OR email LIKE ?)
            ORDER BY name ASC
            LIMIT 10
        `, [`%${q}%`, `%${q}%`]);

        res.json({ success: true, data: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/report-lists/contacts — crear contacto
router.post('/contacts', authenticateToken, async (req, res) => {
    try {
        const { name, email, list_ids } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'El nombre es requerido' });
        if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ success: false, error: 'Email inválido' });

        // Verificar email duplicado
        const [existing] = await execQuery(equipmentPool,
            'SELECT id FROM report_contacts WHERE email = ? LIMIT 1', [email.toLowerCase().trim()]);
        if (existing) return res.status(400).json({ success: false, error: 'Este email ya está registrado' });

        const result = await execQuery(equipmentPool,
            'INSERT INTO report_contacts (name, email) VALUES (?, ?)',
            [name.trim(), email.toLowerCase().trim()]);

        const newId = result.insertId;

        // Asignar a listas si se especificaron
        if (Array.isArray(list_ids) && list_ids.length) {
            for (const lid of list_ids) {
                await execQuery(equipmentPool,
                    'INSERT IGNORE INTO report_list_contacts (list_id, contact_id) VALUES (?,?)',
                    [lid, newId]).catch(() => {});
            }
        }

        console.log(`✅ Contacto creado: ${name} <${email}> (ID: ${newId})`);
        res.status(201).json({ success: true, id: newId, message: 'Contacto creado' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/report-lists/contacts/:id — editar contacto
router.put('/contacts/:id', authenticateToken, async (req, res) => {
    try {
        const { name, email, is_active, list_ids } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'El nombre es requerido' });
        if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ success: false, error: 'Email inválido' });

        // Verificar email duplicado en otro contacto
        const [dup] = await execQuery(equipmentPool,
            'SELECT id FROM report_contacts WHERE email=? AND id!=? LIMIT 1',
            [email.toLowerCase().trim(), req.params.id]);
        if (dup) return res.status(400).json({ success: false, error: 'Este email ya está en uso' });

        await execQuery(equipmentPool, `
            UPDATE report_contacts
            SET name=?, email=?, is_active=?, updated_at=NOW()
            WHERE id=?
        `, [name.trim(), email.toLowerCase().trim(),
            is_active !== undefined ? (is_active ? 1 : 0) : 1,
            req.params.id]);

        // Sincronizar listas si se envían
        if (Array.isArray(list_ids)) {
            await execQuery(equipmentPool,
                'DELETE FROM report_list_contacts WHERE contact_id=?', [req.params.id]);
            for (const lid of list_ids) {
                await execQuery(equipmentPool,
                    'INSERT IGNORE INTO report_list_contacts (list_id, contact_id) VALUES (?,?)',
                    [lid, req.params.id]).catch(() => {});
            }
        }

        res.json({ success: true, message: 'Contacto actualizado' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/report-lists/contacts/:id — eliminar contacto
router.delete('/contacts/:id', authenticateToken, async (req, res) => {
    try {
        await execQuery(equipmentPool,
            'DELETE FROM report_contacts WHERE id=?', [req.params.id]);
        res.json({ success: true, message: 'Contacto eliminado' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/report-lists/contacts/:id/lists — listas a las que pertenece un contacto
router.get('/contacts/:id/lists', authenticateToken, async (req, res) => {
    try {
        const lists = await execQuery(equipmentPool, `
            SELECT l.id, l.name, l.color, l.icon
            FROM report_distribution_lists l
            INNER JOIN report_list_contacts lc ON lc.list_id = l.id
            WHERE lc.contact_id = ?
            ORDER BY l.name ASC
        `, [req.params.id]);
        res.json({ success: true, data: lists });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
