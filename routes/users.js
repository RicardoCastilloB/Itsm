// routes/users.js - API para gestión completa de usuarios

const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { equipmentPool, executeQuery } = require('../config/database');

// Middleware de autenticación y permisos
const { authenticateToken, logActivity } = require('../middleware/auth');
const { checkPermission, adminOnly } = require('../middleware/permissions');

// Middleware de validación
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

// ============================================
// GET /api/users - Listar usuarios (Solo Admin)
// ============================================
router.get('/', 
    authenticateToken,
    adminOnly,
    logActivity('LIST_USERS'),
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 50;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';

            let query;
            let params;

            if (search) {
                query = `
                    SELECT 
                        id, username, email, full_name, role, 
                        employee_cip, is_active, is_verified, 
                        created_at, last_login
                    FROM users 
                    WHERE username LIKE ? OR email LIKE ? OR full_name LIKE ?
                    ORDER BY created_at DESC 
                    LIMIT ? OFFSET ?
                `;
                params = [`%${search}%`, `%${search}%`, `%${search}%`, limit, offset];
            } else {
                query = `
                    SELECT 
                        id, username, email, full_name, role, 
                        employee_cip, is_active, is_verified, 
                        created_at, last_login
                    FROM users 
                    ORDER BY created_at DESC 
                    LIMIT ? OFFSET ?
                `;
                params = [limit, offset];
            }

            const users = await executeQuery(equipmentPool, query, params);
            
            const totalQuery = 'SELECT COUNT(*) as total FROM users';
            const totalResult = await executeQuery(equipmentPool, totalQuery);
            const total = totalResult[0].total;

            res.json({
                success: true,
                data: users,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    itemsPerPage: limit
                }
            });
        } catch (error) {
            console.error('Error listando usuarios:', error);
            res.status(500).json({
                success: false,
                error: 'Error al listar usuarios'
            });
        }
    }
);

// ============================================
// POST /api/users - Crear nuevo usuario (Solo Admin)
// ============================================
router.post('/',
    authenticateToken,
    adminOnly,
    [
        body('username')
            .trim()
            .notEmpty().withMessage('El usuario es requerido')
            .isLength({ min: 3, max: 50 }).withMessage('Debe tener entre 3 y 50 caracteres')
            .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Solo letras, números, _, . y -'),
        body('email')
            .trim()
            .notEmpty().withMessage('El email es requerido')
            .isEmail().withMessage('Email inválido')
            .normalizeEmail(),
        body('full_name')
            .trim()
            .notEmpty().withMessage('El nombre completo es requerido')
            .isLength({ min: 2, max: 100 }).withMessage('Debe tener entre 2 y 100 caracteres'),
        body('password')
            .notEmpty().withMessage('La contraseña es requerida')
            .isLength({ min: 8 }).withMessage('Mínimo 8 caracteres')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Debe contener mayúsculas, minúsculas y números'),
        body('role')
            .notEmpty().withMessage('El rol es requerido')
            .isIn(['visor', 'editor', 'administrador']).withMessage('Rol inválido'),
        body('employee_cip').optional().trim(),
        body('is_active').optional().isBoolean(),
        body('is_verified').optional().isBoolean()
    ],
    validate,
    logActivity('CREATE_USER'),
    async (req, res) => {
        try {
            const { 
                username, 
                email, 
                full_name, 
                password, 
                role, 
                employee_cip,
                is_active = true,
                is_verified = false
            } = req.body;

            // Verificar si el username ya existe
            const checkUsername = await executeQuery(
                equipmentPool,
                'SELECT id FROM users WHERE username = ? LIMIT 1',
                [username]
            );

            if (checkUsername.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'El usuario ya existe'
                });
            }

            // Verificar si el email ya existe
            const checkEmail = await executeQuery(
                equipmentPool,
                'SELECT id FROM users WHERE email = ? LIMIT 1',
                [email]
            );

            if (checkEmail.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'El email ya está registrado'
                });
            }

            // Encriptar contraseña
            const passwordHash = await bcrypt.hash(password, 10);

            // Insertar nuevo usuario
            const insertQuery = `
                INSERT INTO users 
                (username, email, password_hash, full_name, role, employee_cip, is_active, is_verified, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            `;
            
            const result = await executeQuery(
                equipmentPool,
                insertQuery,
                [username, email, passwordHash, full_name, role, employee_cip || null, is_active ? 1 : 0, is_verified ? 1 : 0, req.user.id]
            );

            console.log(`✅ Usuario creado: ${username} (ID: ${result.insertId}) por ${req.user.username}`);

            // Registrar en audit_log
            await executeQuery(
                equipmentPool,
                'INSERT INTO audit_log (user_id, action, ip_address) VALUES (?, ?, ?)',
                [result.insertId, 'USER_CREATED', req.ip || 'unknown']
            );

            res.status(201).json({
                success: true,
                message: 'Usuario creado exitosamente',
                data: {
                    id: result.insertId,
                    username,
                    email,
                    full_name,
                    role
                }
            });

        } catch (error) {
            console.error('Error creando usuario:', error);
            res.status(500).json({
                success: false,
                error: 'Error al crear usuario'
            });
        }
    }
);

// ============================================
// GET /api/users/:id - Obtener usuario por ID (Solo Admin)
// ============================================
router.get('/:id',
    authenticateToken,
    adminOnly,
    [
        param('id').isInt().withMessage('ID inválido')
    ],
    validate,
    async (req, res) => {
        try {
            const query = `
                SELECT 
                    id, username, email, full_name, role, 
                    employee_cip, is_active, is_verified, 
                    created_at, updated_at, last_login
                FROM users 
                WHERE id = ? 
                LIMIT 1
            `;
            
            const users = await executeQuery(equipmentPool, query, [req.params.id]);

            if (users.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Usuario no encontrado'
                });
            }

            res.json({
                success: true,
                data: users[0]
            });

        } catch (error) {
            console.error('Error obteniendo usuario:', error);
            res.status(500).json({
                success: false,
                error: 'Error al obtener usuario'
            });
        }
    }
);

// ============================================
// PUT /api/users/:id - Actualizar usuario (Solo Admin)
// ============================================
router.put('/:id',
    authenticateToken,
    adminOnly,
    [
        param('id').isInt().withMessage('ID inválido'),
        body('username').optional().trim().isLength({ min: 3, max: 50 }),
        body('email').optional().trim().isEmail().normalizeEmail(),
        body('full_name').optional().trim().isLength({ min: 2, max: 100 }),
        body('role').optional().isIn(['visor', 'editor', 'administrador']),
        body('employee_cip').optional().trim(),
        body('is_active').optional().isBoolean(),
        body('is_verified').optional().isBoolean()
    ],
    validate,
    logActivity('UPDATE_USER'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const updateFields = req.body;

            // Verificar que el usuario existe
            const checkUser = await executeQuery(
                equipmentPool,
                'SELECT id FROM users WHERE id = ? LIMIT 1',
                [id]
            );

            if (checkUser.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Usuario no encontrado'
                });
            }

            // Si se actualiza el username, verificar que no exista
            if (updateFields.username) {
                const checkUsername = await executeQuery(
                    equipmentPool,
                    'SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1',
                    [updateFields.username, id]
                );

                if (checkUsername.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'El usuario ya está en uso'
                    });
                }
            }

            // Si se actualiza el email, verificar que no exista
            if (updateFields.email) {
                const checkEmail = await executeQuery(
                    equipmentPool,
                    'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
                    [updateFields.email, id]
                );

                if (checkEmail.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'El email ya está registrado'
                    });
                }
            }

            // Construir query de actualización
            const allowedFields = ['username', 'email', 'full_name', 'role', 'employee_cip', 'is_active', 'is_verified'];
            const updates = [];
            const values = [];

            for (const field of allowedFields) {
                if (updateFields[field] !== undefined) {
                    updates.push(`${field} = ?`);
                    values.push(updateFields[field]);
                }
            }

            if (updates.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No hay campos para actualizar'
                });
            }

            values.push(id);

            const updateQuery = `
                UPDATE users 
                SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;

            await executeQuery(equipmentPool, updateQuery, values);

            console.log(`✅ Usuario ${id} actualizado por ${req.user.username}`);

            res.json({
                success: true,
                message: 'Usuario actualizado exitosamente'
            });

        } catch (error) {
            console.error('Error actualizando usuario:', error);
            res.status(500).json({
                success: false,
                error: 'Error al actualizar usuario'
            });
        }
    }
);

// ============================================
// DELETE /api/users/:id - Eliminar usuario (Solo Admin)
// ============================================
router.delete('/:id',
    authenticateToken,
    adminOnly,
    [
        param('id').isInt().withMessage('ID inválido')
    ],
    validate,
    logActivity('DELETE_USER'),
    async (req, res) => {
        try {
            const { id } = req.params;

            // No permitir eliminar el propio usuario
            if (parseInt(id) === req.user.id) {
                return res.status(400).json({
                    success: false,
                    error: 'No puedes eliminar tu propio usuario'
                });
            }

            // Verificar que el usuario existe
            const checkUser = await executeQuery(
                equipmentPool,
                'SELECT username FROM users WHERE id = ? LIMIT 1',
                [id]
            );

            if (checkUser.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Usuario no encontrado'
                });
            }

            // Soft delete
            await executeQuery(
                equipmentPool,
                'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [id]
            );

            console.log(`🗑️ Usuario ${checkUser[0].username} (ID: ${id}) desactivado por ${req.user.username}`);

            res.json({
                success: true,
                message: 'Usuario desactivado exitosamente'
            });

        } catch (error) {
            console.error('Error eliminando usuario:', error);
            res.status(500).json({
                success: false,
                error: 'Error al eliminar usuario'
            });
        }
    }
);

module.exports = router;