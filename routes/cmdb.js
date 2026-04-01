// routes/cmdb.js — CMDB (Configuration Management Database)
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { ConfigItem, CiType, CiRelationship } = require('../src/models');
const { authenticateToken } = require('../middleware/auth');
const { Op } = require('sequelize');
const sequelize = require('../src/config/database');
const { QueryTypes } = require('sequelize');

// GET /api/cmdb/types
router.get('/types', authenticateToken, async (req, res) => {
    try {
        const types = await CiType.findAll({ order: [['name', 'ASC']] });
        res.json({ success: true, data: types });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/cmdb/kpis
router.get('/kpis', authenticateToken, async (req, res) => {
    try {
        const [rows] = await sequelize.query(`
            SELECT
              COUNT(*)                          AS total,
              SUM(status = 'activo')            AS activos,
              SUM(status = 'inactivo')          AS inactivos,
              SUM(status = 'en_mantenimiento')  AS mantenimiento,
              SUM(status = 'retirado')          AS retirados
            FROM config_items WHERE deleted_at IS NULL
        `, { type: QueryTypes.SELECT });
        const [rels] = await sequelize.query(
            `SELECT COUNT(*) AS relaciones FROM ci_relationships`,
            { type: QueryTypes.SELECT }
        );
        res.json({ success: true, data: { ...rows[0], relaciones: rels[0].relaciones } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/cmdb
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { ciTypeId, status, environment, search, page = 1, limit = 25 } = req.query;
        const where = {};
        if (ciTypeId)     where.ciTypeId    = ciTypeId;
        if (status)       where.status      = status;
        if (environment)  where.environment = environment;
        if (search)       where.name        = { [Op.like]: `%${search}%` };

        const { count, rows } = await ConfigItem.findAndCountAll({
            where,
            include: [{ model: CiType, as: 'tipo' }],
            order: [['name', 'ASC']],
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
        });
        res.json({ success: true, data: rows, total: count, page: parseInt(page) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/cmdb/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const ci = await ConfigItem.findByPk(req.params.id, {
            include: [{ model: CiType, as: 'tipo' }],
        });
        if (!ci) return res.status(404).json({ success: false, error: 'CI no encontrado' });

        // Relaciones
        const [rels] = await sequelize.query(`
            SELECT cr.*,
                   src.name AS source_name, src_t.name AS source_type,
                   tgt.name AS target_name, tgt_t.name AS target_type,
                   cr.relationship
            FROM ci_relationships cr
            JOIN config_items src ON cr.source_id = src.id
            JOIN config_items tgt ON cr.target_id = tgt.id
            JOIN ci_types src_t   ON src.ci_type_id = src_t.id
            JOIN ci_types tgt_t   ON tgt.ci_type_id = tgt_t.id
            WHERE cr.source_id = ? OR cr.target_id = ?
        `, { replacements: [ci.id, ci.id], type: QueryTypes.SELECT });

        res.json({ success: true, data: ci, relationships: rels });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/cmdb
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { ciTypeId, name, status, environment, location, ipAddress, serialNumber, version, attributes } = req.body;
        if (!ciTypeId || !name) return res.status(400).json({ success: false, error: 'ciTypeId y name requeridos' });

        const ci = await ConfigItem.create({
            id: uuidv4(),
            ciTypeId, name,
            status:       status      || 'activo',
            environment:  environment || 'produccion',
            ownerId:      req.user.id,
            location:     location    || null,
            ipAddress:    ipAddress   || null,
            serialNumber: serialNumber|| null,
            version:      version     || null,
            attributes:   attributes  || null,
        });
        res.status(201).json({ success: true, data: ci });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/cmdb/:id
router.patch('/:id', authenticateToken, async (req, res) => {
    try {
        const ci = await ConfigItem.findByPk(req.params.id);
        if (!ci) return res.status(404).json({ success: false, error: 'CI no encontrado' });

        const allowed = ['name','status','environment','location','ipAddress','serialNumber','version','attributes'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        await ci.update(updates);
        res.json({ success: true, data: ci });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/cmdb/:id
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const ci = await ConfigItem.findByPk(req.params.id);
        if (!ci) return res.status(404).json({ success: false, error: 'CI no encontrado' });
        await ci.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/cmdb/:id/relationships
router.post('/:id/relationships', authenticateToken, async (req, res) => {
    try {
        const { targetId, relationship } = req.body;
        if (!targetId || !relationship) {
            return res.status(400).json({ success: false, error: 'targetId y relationship requeridos' });
        }
        const rel = await CiRelationship.create({
            id: uuidv4(),
            sourceId: req.params.id,
            targetId,
            relationship,
        });
        res.status(201).json({ success: true, data: rel });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/cmdb/relationships/:relId
router.delete('/relationships/:relId', authenticateToken, async (req, res) => {
    try {
        const rel = await CiRelationship.findByPk(req.params.relId);
        if (!rel) return res.status(404).json({ success: false, error: 'Relación no encontrada' });
        await rel.destroy();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
