// routes/reports-itsm.js — Reportes ITSM + exportación
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 }    = require('uuid');
const { ReportJob }     = require('../src/models');
const { enqueueReport } = require('../src/queues/index');
const { authenticateToken } = require('../middleware/auth');
const sequelize = require('../src/config/database');
const { QueryTypes } = require('sequelize');

// GET /api/reports-itsm/sla-compliance — % cumplimiento SLA por prioridad y agente
router.get('/sla-compliance', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let dateClause = '';
        const rep = [];
        if (startDate) { dateClause += ' AND t.created_at >= ?'; rep.push(startDate); }
        if (endDate)   { dateClause += ' AND t.created_at <= ?'; rep.push(endDate + ' 23:59:59'); }

        const [byPriority] = await sequelize.query(`
            SELECT priority,
                   COUNT(*) AS total,
                   SUM(sla_status = 'ok' OR status IN ('resuelto','cerrado') AND sla_status != 'vencido') AS cumplidos,
                   SUM(sla_status = 'vencido') AS vencidos,
                   ROUND(100.0 * SUM(sla_status != 'vencido') / COUNT(*), 1) AS pct_cumplimiento
            FROM tickets t WHERE deleted_at IS NULL ${dateClause}
            GROUP BY priority ORDER BY FIELD(priority,'critica','alta','media','baja')
        `, { replacements: rep, type: QueryTypes.SELECT });

        const [byAgent] = await sequelize.query(`
            SELECT u.full_name AS agente, u.email,
                   COUNT(t.id) AS total,
                   SUM(t.sla_status != 'vencido') AS cumplidos,
                   SUM(t.sla_status = 'vencido')  AS vencidos,
                   ROUND(100.0 * SUM(t.sla_status != 'vencido') / COUNT(t.id), 1) AS pct
            FROM tickets t
            JOIN users u ON t.assigned_to = u.id
            WHERE t.deleted_at IS NULL ${dateClause}
            GROUP BY t.assigned_to
            ORDER BY pct ASC
            LIMIT 20
        `, { replacements: rep, type: QueryTypes.SELECT });

        res.json({ success: true, data: { byPriority, byAgent } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/trends — Tendencias de tickets (últimos 30 días)
router.get('/trends', authenticateToken, async (req, res) => {
    try {
        const [daily] = await sequelize.query(`
            SELECT DATE(created_at) AS fecha,
                   COUNT(*) AS creados,
                   SUM(status IN ('resuelto','cerrado')) AS resueltos
            FROM tickets
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND deleted_at IS NULL
            GROUP BY DATE(created_at)
            ORDER BY fecha ASC
        `, { type: QueryTypes.SELECT });

        const [byStatus] = await sequelize.query(`
            SELECT status, COUNT(*) AS total FROM tickets WHERE deleted_at IS NULL GROUP BY status
        `, { type: QueryTypes.SELECT });

        const [byPriority] = await sequelize.query(`
            SELECT priority, COUNT(*) AS total FROM tickets WHERE deleted_at IS NULL GROUP BY priority
        `, { type: QueryTypes.SELECT });

        const [byCat] = await sequelize.query(`
            SELECT c.name AS categoria, COUNT(t.id) AS total
            FROM tickets t LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.deleted_at IS NULL GROUP BY t.category_id ORDER BY total DESC LIMIT 8
        `, { type: QueryTypes.SELECT });

        res.json({ success: true, data: { daily, byStatus, byPriority, byCat } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/agent-load — Carga por agente
router.get('/agent-load', authenticateToken, async (req, res) => {
    try {
        const [rows] = await sequelize.query(`
            SELECT u.full_name AS agente, u.email,
                   COUNT(t.id) AS total_abiertos,
                   SUM(t.priority = 'critica') AS criticos,
                   SUM(t.priority = 'alta')    AS altos,
                   SUM(t.sla_status = 'riesgo' OR t.sla_status = 'vencido') AS en_riesgo,
                   AVG(TIMESTAMPDIFF(HOUR, t.created_at, IFNULL(t.resolved_at, NOW()))) AS avg_horas
            FROM tickets t
            JOIN users u ON t.assigned_to = u.id
            WHERE t.status NOT IN ('resuelto','cerrado') AND t.deleted_at IS NULL
            GROUP BY t.assigned_to
            ORDER BY total_abiertos DESC
        `, { type: QueryTypes.SELECT });
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/agent-dashboard — Dashboard del agente autenticado
router.get('/agent-dashboard', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [kpis] = await sequelize.query(`
            SELECT
              SUM(status NOT IN ('resuelto','cerrado'))                       AS mis_abiertos,
              SUM(status NOT IN ('resuelto','cerrado') AND sla_status='riesgo') AS en_riesgo,
              SUM(status NOT IN ('resuelto','cerrado') AND sla_status='vencido') AS vencidos,
              SUM(DATE(resolved_at) = CURDATE())                              AS resueltos_hoy
            FROM tickets WHERE assigned_to = ? AND deleted_at IS NULL
        `, { replacements: [userId], type: QueryTypes.SELECT });

        const [misTickets] = await sequelize.query(`
            SELECT t.*, c.name AS category_name
            FROM tickets t LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.assigned_to = ? AND t.status NOT IN ('resuelto','cerrado')
              AND t.deleted_at IS NULL
            ORDER BY FIELD(t.sla_status,'vencido','riesgo','ok'), FIELD(t.priority,'critica','alta','media','baja')
            LIMIT 20
        `, { replacements: [userId], type: QueryTypes.SELECT });

        res.json({ success: true, data: { kpis: kpis[0], tickets: misTickets } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/reports-itsm/export — Encolar generación de reporte
router.post('/export', authenticateToken, async (req, res) => {
    try {
        const { type = 'csv', filters } = req.body;
        const jobId = uuidv4();

        const reportJob = await ReportJob.create({
            id: jobId, userId: req.user.id, type, filters, status: 'pending',
        });

        // Encolar
        const bullJob = await enqueueReport({ type, filters, userId: req.user.id, reportId: jobId });

        // Escuchar resultado del worker y actualizar DB
        bullJob.finished()
            .then(async (result) => {
                await ReportJob.update(
                    { status: 'done', fileUrl: result.url, rowCount: result.rows, completedAt: new Date() },
                    { where: { id: jobId } }
                );
                const io = req.app.get('io');
                if (io) io.to(`user:${req.user.id}`).emit('report-ready', { jobId, url: result.url });
            })
            .catch(async (err) => {
                await ReportJob.update({ status: 'failed', errorMsg: err.message }, { where: { id: jobId } });
            });

        res.json({ success: true, jobId, message: 'Reporte en cola, recibirás una notificación cuando esté listo.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/reports-itsm/jobs — Estado de mis reportes
router.get('/jobs', authenticateToken, async (req, res) => {
    try {
        const jobs = await ReportJob.findAll({
            where: { userId: req.user.id },
            order: [['requested_at', 'DESC']],
            limit: 10,
        });
        res.json({ success: true, data: jobs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
