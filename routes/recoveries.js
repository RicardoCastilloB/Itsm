// ============================================================================
// routes/recoveries.js — MÓDULO DE RECUPERO DE EQUIPOS
// ============================================================================

const express = require('express');
const router  = express.Router();
const { equipmentPool, executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ============================================================================
// GET /api/recoveries — JOIN directo, sin depender de vistas
// ============================================================================
router.get('/',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { status, method } = req.query;
            const params = [];
            let where = '1=1';

            if (status && status !== 'todos') {
                where += ' AND r.status = ?';
                params.push(status);
            }
            if (method && method !== 'todos') {
                where += ' AND r.recovery_method = ?';
                params.push(method);
            }

            const query = `
                SELECT
                    r.id                AS recovery_id,
                    r.status,
                    r.recovery_method,
                    r.technician_name,
                    r.technician_note,
                    r.scheduled_date,
                    r.completed_at,
                    r.notes,
                    r.created_at,
                    r.updated_at,

                    eq.id               AS equipment_id,
                    eq.device_code,
                    eq.brand            AS equipment_brand,
                    eq.model            AS equipment_model,
                    eq.serial_number,
                    eq.status           AS equipment_status,

                    e.id                AS employee_id,
                    e.full_name         AS employee_name,
                    e.cip               AS employee_cip,
                    e.email             AS employee_email,
                    e.position_name,

                    a.id                AS assignment_id,
                    a.assignment_date,

                    d.department_name,
                    l.location_name

                FROM equipment_recoveries r
                LEFT JOIN equipment   eq ON r.equipment_id  = eq.id
                LEFT JOIN employees   e  ON r.employee_id   = e.id
                LEFT JOIN assignments a  ON r.assignment_id = a.id
                LEFT JOIN departments d  ON e.department_id = d.id
                LEFT JOIN locations   l  ON a.location_id   = l.id
                WHERE ${where}
                ORDER BY
                    FIELD(r.status,
                        'por_recuperar','en_gestion','recogido_tecnico',
                        'traido_oficina','en_revision','listo_para_asignar',
                        'envio_provincia','recuperado'),
                    r.created_at DESC
            `;

            const rows = await executeQuery(equipmentPool, query, params);

            const [kpis] = await executeQuery(equipmentPool, `
                SELECT
                    COUNT(*)                                                                    AS total,
                    SUM(status = 'por_recuperar')                                              AS por_recuperar,
                    SUM(status IN ('en_gestion','recogido_tecnico','traido_oficina'))           AS en_proceso,
                    SUM(status = 'en_revision')                                                AS en_revision,
                    SUM(status = 'listo_para_asignar')                                         AS listos,
                    SUM(status = 'recuperado'
                        AND MONTH(completed_at) = MONTH(NOW())
                        AND YEAR(completed_at)  = YEAR(NOW()))                                 AS recuperados_mes
                FROM equipment_recoveries
            `);

            res.json({ success: true, data: rows, count: rows.length, kpis });

        } catch (error) {
            console.error('❌ GET /api/recoveries:', error);
            next(error);
        }
    }
);

// ============================================================================
// GET /api/recoveries/kpis
// ============================================================================
router.get('/kpis',
    authenticateToken,
    async (req, res, next) => {
        try {
            const [kpis] = await executeQuery(equipmentPool, `
                SELECT
                    SUM(status = 'por_recuperar')                                              AS por_recuperar,
                    SUM(status IN ('en_gestion','recogido_tecnico','traido_oficina'))           AS en_proceso,
                    SUM(status = 'en_revision')                                                AS en_revision,
                    SUM(status = 'listo_para_asignar')                                         AS listos,
                    SUM(status = 'recuperado'
                        AND MONTH(completed_at) = MONTH(NOW())
                        AND YEAR(completed_at)  = YEAR(NOW()))                                 AS recuperados_mes
                FROM equipment_recoveries
            `);
            res.json({ success: true, data: kpis });
        } catch (error) { next(error); }
    }
);

// ============================================================================
// POST /api/recoveries — Crear recupero manual
// ============================================================================
router.post('/',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { equipment_id, equipment_code, employee_id, assignment_id,
                    recovery_method, technician_name, scheduled_date, notes } = req.body;

            let eqId = equipment_id;
            if (!eqId && equipment_code) {
                const [eq] = await executeQuery(equipmentPool,
                    'SELECT id FROM equipment WHERE device_code = ? LIMIT 1', [equipment_code]);
                if (!eq) return res.status(404).json({ success: false, message: 'Equipo no encontrado' });
                eqId = eq.id;
            }

            if (!eqId || !employee_id) {
                return res.status(400).json({ success: false, message: 'Se requiere equipo y empleado' });
            }

            const existing = await executeQuery(equipmentPool,
                "SELECT id FROM equipment_recoveries WHERE equipment_id = ? AND status != 'recuperado' LIMIT 1",
                [eqId]);
            if (existing.length > 0) {
                return res.status(409).json({ success: false, message: 'Ya existe un recupero activo para este equipo' });
            }

            const result = await executeQuery(equipmentPool, `
                INSERT INTO equipment_recoveries
                    (assignment_id, equipment_id, employee_id, recovery_method, technician_name, scheduled_date, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [assignment_id||null, eqId, employee_id, recovery_method||'pendiente',
                technician_name||null, scheduled_date||null, notes||null]);

            await executeQuery(equipmentPool,
                'INSERT INTO equipment_recovery_logs (recovery_id, new_status, note) VALUES (?, ?, ?)',
                [result.insertId, 'por_recuperar', 'Recupero creado manualmente']);

            res.status(201).json({ success: true, message: 'Recupero creado', data: { id: result.insertId } });
        } catch (error) {
            console.error('❌ POST /api/recoveries:', error);
            next(error);
        }
    }
);

// ============================================================================
// PUT /api/recoveries/:id/status — Cambiar estado
// ============================================================================
router.put('/:id/status',
    authenticateToken,
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const { status, recovery_method, technician_name, technician_note, scheduled_date } = req.body;

            const VALID = ['por_recuperar','en_gestion','recogido_tecnico','traido_oficina',
                           'en_revision','listo_para_asignar','envio_provincia','recuperado'];
            if (!VALID.includes(status)) {
                return res.status(400).json({ success: false, message: 'Estado inválido' });
            }

            const [current] = await executeQuery(equipmentPool,
                'SELECT status, equipment_id FROM equipment_recoveries WHERE id = ? LIMIT 1', [id]);
            if (!current) return res.status(404).json({ success: false, message: 'Recupero no encontrado' });

            const completedAt = status === 'recuperado' ? new Date() : null;

            await executeQuery(equipmentPool, `
                UPDATE equipment_recoveries SET
                    status          = ?,
                    recovery_method = COALESCE(?, recovery_method),
                    technician_name = COALESCE(?, technician_name),
                    technician_note = COALESCE(?, technician_note),
                    scheduled_date  = COALESCE(?, scheduled_date),
                    completed_at    = COALESCE(?, completed_at),
                    updated_at      = NOW()
                WHERE id = ?
            `, [status, recovery_method||null, technician_name||null,
                technician_note||null, scheduled_date||null, completedAt, id]);

            if (['listo_para_asignar','recuperado'].includes(status)) {
                await executeQuery(equipmentPool,
                    "UPDATE equipment SET status = 'Disponible' WHERE id = ?",
                    [current.equipment_id]);
            }

            await executeQuery(equipmentPool,
                'INSERT INTO equipment_recovery_logs (recovery_id, old_status, new_status, note) VALUES (?, ?, ?, ?)',
                [id, current.status, status, technician_note||null]);

            res.json({ success: true, message: 'Estado actualizado' });
        } catch (error) {
            console.error('❌ PUT /api/recoveries/:id/status:', error);
            next(error);
        }
    }
);

// ============================================================================
// GET /api/recoveries/:id/logs
// ============================================================================
router.get('/:id/logs',
    authenticateToken,
    async (req, res, next) => {
        try {
            const logs = await executeQuery(equipmentPool,
                'SELECT * FROM equipment_recovery_logs WHERE recovery_id = ? ORDER BY created_at ASC',
                [req.params.id]);
            res.json({ success: true, data: logs });
        } catch (error) { next(error); }
    }
);

// ============================================================================
// DELETE /api/recoveries/:id
// ============================================================================
router.delete('/:id',
    authenticateToken,
    async (req, res, next) => {
        try {
            const result = await executeQuery(equipmentPool,
                'DELETE FROM equipment_recoveries WHERE id = ?', [req.params.id]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Recupero no encontrado' });
            }
            res.json({ success: true, message: 'Recupero eliminado' });
        } catch (error) { next(error); }
    }
);

module.exports = router;
