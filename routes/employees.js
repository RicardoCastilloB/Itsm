// routes/employees.js - API de empleados con control de permisos

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { equipmentPool, callStoredProcedure, executeQuery } = require('../config/database');

const { authenticateToken, optionalAuth, logActivity } = require('../middleware/auth');
const { checkPermission, checkMethodPermission, adminOnly, canEdit } = require('../middleware/permissions');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
};

// ── Vista empleados (GET /employees) ──────────────────────────────────────
router.get('/employees', authenticateToken, async (req, res) => {
    try {
        const query = 'SELECT * FROM employees ORDER BY is_active DESC, full_name';
        const employees = await executeQuery(equipmentPool, query);
        res.render('employees', {
            title: 'Gestión de Empleados',
            employees,
            currentPage: 1,
            totalPages: 1,
            search: ''
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).send('Error al cargar empleados');
    }
});

// ── PUT /:id — Dar de baja / reactivar ────────────────────────────────────
// (ÚNICO bloque PUT /:id — los duplicados han sido eliminados)
router.put('/:id',
    authenticateToken,
    checkPermission('employees', 'update'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { is_active } = req.body;

            console.log('📝 Actualizando empleado ID:', id, 'is_active:', is_active);

            const updateQuery = `
                UPDATE employees 
                SET is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            const result = await executeQuery(equipmentPool, updateQuery, [is_active ? 1 : 0, id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
            }

            if (!is_active) {
                // 1️⃣ Crear recuperos directamente (sin depender del SP)
                try {
                    const assignments = await executeQuery(equipmentPool, `
                        SELECT a.id AS assignment_id, a.equipment_id
                        FROM assignments a
                        WHERE a.employee_id = ? AND a.return_date IS NULL AND a.status = 'activo'
                    `, [id]);

                    for (const asgn of assignments) {
                        const existing = await executeQuery(equipmentPool,
                            `SELECT id FROM equipment_recoveries WHERE equipment_id=? AND status != 'recuperado' LIMIT 1`,
                            [asgn.equipment_id]
                        );
                        if (existing.length) continue;

                        const recResult = await executeQuery(equipmentPool, `
                            INSERT INTO equipment_recoveries
                                (assignment_id, equipment_id, employee_id, recovery_method, notes)
                            VALUES (?, ?, ?, 'pendiente', 'Generado automáticamente al dar de baja')
                        `, [asgn.assignment_id, asgn.equipment_id, id]);

                        await executeQuery(equipmentPool,
                            `INSERT INTO equipment_recovery_logs (recovery_id, new_status, note) VALUES (?, 'por_recuperar', 'Empleado dado de baja')`,
                            [recResult.insertId]
                        ).catch(() => {});
                    }
                    console.log(`♻️  Recuperos creados para empleado ID: ${id}`);
                } catch (spErr) {
                    console.error('⚠️  Error creando recuperos:', spErr.message);
                }

                // 2️⃣ Poner equipos asignados en "En Mantenimiento"
                try {
                    await executeQuery(equipmentPool, `
                        UPDATE equipment eq
                        INNER JOIN assignments a ON a.equipment_id = eq.id
                        SET eq.status = 'En Mantenimiento'
                        WHERE a.employee_id = ?
                          AND a.status = 'activo'
                          AND eq.status = 'Asignado'
                    `, [id]);
                    console.log(`🔧 Equipos del empleado ID ${id} → En Mantenimiento`);
                } catch (eqErr) {
                    console.error('⚠️  Error actualizando estado de equipos:', eqErr.message);
                }
            }

            const [employee] = await executeQuery(
                equipmentPool,
                'SELECT id, full_name, is_active FROM employees WHERE id = ?',
                [id]
            );

            console.log('✅ Estado actualizado en BD:', employee);

            res.json({ success: true, message: 'Empleado actualizado correctamente', data: employee });

        } catch (error) {
            console.error('❌ Error actualizando empleado:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
);

// ── GET /search-emails ────────────────────────────────────────────────────
router.get('/search-emails', optionalAuth, async (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ success: true, data: [] });

        const results = await executeQuery(equipmentPool, `
            SELECT DISTINCT email, full_name, cip, position_name
            FROM employees
            WHERE (email LIKE ? OR full_name LIKE ?) AND is_active = 1
            ORDER BY full_name ASC LIMIT 10
        `, [`%${q}%`, `%${q}%`]);

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('❌ Error buscando emails:', error);
        next(error);
    }
});

// ── GET /bajas ────────────────────────────────────────────────────────────
router.get('/bajas',
    authenticateToken,
    checkPermission('employees', 'read'),
    async (req, res) => {
        try {
            const empleados = await executeQuery(equipmentPool, `
                SELECT id, cip, national_id, full_name, email, department_id,
                       position, position_name, category, employee_group,
                       branch_office_id, state, supervisor_name, is_active, updated_at
                FROM employees 
                WHERE is_active = FALSE 
                ORDER BY updated_at DESC
            `);
            res.json({ success: true, data: empleados, count: empleados.length });
        } catch (error) {
            console.error('Error listando empleados de baja:', error);
            res.status(500).json({ success: false, error: 'Error al listar empleados de baja' });
        }
    }
);

// ── PUT /toggle-status ────────────────────────────────────────────────────
router.put('/toggle-status', async (req, res) => {
    try {
        const { cip, is_active } = req.body;
        if (!cip) return res.status(400).json({ success: false, error: 'CIP es requerido' });

        const newStatus = is_active ? 1 : 0;
        const [result] = await executeQuery(
            equipmentPool,
            'UPDATE employees SET is_active = ?, updated_at = NOW() WHERE cip = ?',
            [newStatus, cip]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
        }

        res.json({
            success: true,
            message: `Empleado ${newStatus ? 'activado' : 'dado de baja'} correctamente`,
            data: { cip, is_active: newStatus }
        });
    } catch (error) {
        console.error('❌ Error cambiando estado:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ── GET /planilla ─────────────────────────────────────────────────────────
router.get('/planilla', async (req, res, next) => {
    try {
        const results = await executeQuery(equipmentPool, 'SELECT COUNT(*) AS total_empleados FROM employees');
        res.json(results[0].total_empleados);
    } catch (error) {
        next(error);
    }
});

// ── GET / — Listar empleados (API) ────────────────────────────────────────
router.get('/',
    authenticateToken,
    checkPermission('employees', 'read'),
    logActivity('LIST_EMPLOYEES'),
    async (req, res) => {
        try {
            const page   = parseInt(req.query.page)  || 1;
            const limit  = parseInt(req.query.limit) || 50;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';

            let queryStr, params;

            if (search) {
                queryStr = `
                    SELECT * FROM employees 
                    WHERE is_active = TRUE 
                        AND (full_name LIKE ? OR email LIKE ? OR cip LIKE ?)
                    ORDER BY full_name LIMIT ? OFFSET ?
                `;
                params = [`%${search}%`, `%${search}%`, `%${search}%`, limit, offset];
            } else {
                queryStr = `SELECT * FROM employees WHERE is_active = TRUE ORDER BY full_name LIMIT ? OFFSET ?`;
                params   = [limit, offset];
            }

            const employees   = await executeQuery(equipmentPool, queryStr, params);
            const totalResult = await executeQuery(equipmentPool, 'SELECT COUNT(*) as total FROM employees WHERE is_active = TRUE');
            const total       = totalResult[0].total;

            res.json({
                success: true,
                data: employees,
                pagination: {
                    currentPage: page,
                    totalPages:  Math.ceil(total / limit),
                    totalItems:  total,
                    itemsPerPage: limit
                },
                userPermissions: {
                    canCreate: ['administrador', 'editor'].includes(req.user.role),
                    canEdit:   ['administrador', 'editor'].includes(req.user.role),
                    canDelete: req.user.role === 'administrador'
                }
            });
        } catch (error) {
            console.error('Error listando empleados:', error);
            res.status(500).json({ success: false, error: 'Error al listar empleados' });
        }
    }
);

// ── GET /search ───────────────────────────────────────────────────────────
router.get('/search',
    authenticateToken,
    checkPermission('employees', 'read'),
    [query('q').optional().isLength({ min: 2 }).withMessage('Mínimo 2 caracteres')],
    validate,
    async (req, res) => {
        try {
            const searchTerm = req.query.q || '';
            const employees  = await executeQuery(equipmentPool, `
                SELECT * FROM employees 
                WHERE is_active = TRUE 
                    AND (full_name LIKE ? OR email LIKE ? OR cip LIKE ?)
                ORDER BY full_name LIMIT 50
            `, [`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`]);

            res.json({ success: true, data: employees, count: employees.length });
        } catch (error) {
            console.error('Error buscando empleados:', error);
            res.status(500).json({ success: false, error: 'Error al buscar empleados' });
        }
    }
);

// ── POST / — Crear empleado ───────────────────────────────────────────────
router.post('/',
    authenticateToken,
    checkPermission('employees', 'create'),
    [
        body('full_name').trim().notEmpty().withMessage('El nombre completo es requerido'),
        body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
        body('cip').optional().trim(),
        body('department_id').optional().isInt().withMessage('Department ID debe ser un número'),
        body('position').optional().trim()
    ],
    validate,
    logActivity('CREATE_EMPLOYEE'),
    async (req, res) => {
        try {
            const { full_name, email, cip, department_id, position, is_active } = req.body;

            const checkEmail = await executeQuery(equipmentPool, 'SELECT id FROM employees WHERE email = ? LIMIT 1', [email]);
            if (checkEmail.length > 0) {
                return res.status(400).json({ success: false, error: 'El email ya está registrado' });
            }

            const result = await executeQuery(equipmentPool, `
                INSERT INTO employees (full_name, email, cip, department_id, position, is_active)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [full_name, email, cip || null, department_id || null, position || null, is_active !== undefined ? is_active : true]);

            console.log(`✅ Empleado creado con ID: ${result.insertId}`);

            res.status(201).json({
                success: true,
                message: 'Empleado creado exitosamente',
                data: { id: result.insertId, full_name, email, cip: cip || null }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Error al crear empleado' });
        }
    }
);

// ── DELETE /:id ───────────────────────────────────────────────────────────
router.delete('/:id',
    authenticateToken,
    checkPermission('employees', 'delete'),
    [param('id').isInt().withMessage('ID debe ser un número entero')],
    validate,
    logActivity('DELETE_EMPLOYEE'),
    async (req, res) => {
        try {
            const { id } = req.params;

            const checkEmployee = await executeQuery(equipmentPool, 'SELECT id, full_name FROM employees WHERE id = ? LIMIT 1', [id]);
            if (checkEmployee.length === 0) {
                return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
            }

            const activeAssignments = await executeQuery(equipmentPool,
                'SELECT COUNT(*) as count FROM assignments WHERE employee_id = ? AND return_date IS NULL', [id]);
            if (activeAssignments[0].count > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No se puede eliminar un empleado con asignaciones activas',
                    activeAssignments: activeAssignments[0].count
                });
            }

            await executeQuery(equipmentPool,
                'UPDATE employees SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);

            res.json({ success: true, message: 'Empleado eliminado exitosamente' });
        } catch (error) {
            console.error('Error eliminando empleado:', error);
            res.status(500).json({ success: false, error: 'Error al eliminar empleado' });
        }
    }
);

module.exports = router;
