// routes/permissions.js - Rutas para gestionar permisos

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

const { getUserPermissions, ROLES, PERMISSIONS } = require('../middleware/permissions');

// ============================================
// GET /api/permissions/me - Obtener mis permisos
// ============================================
router.get('/me', authenticateToken, getUserPermissions);

// ============================================
// GET /api/permissions/roles - Listar todos los roles disponibles
// ============================================
router.get('/roles', authenticateToken, (req, res) => {
    res.json({
        success: true,
        roles: [
            {
                value: ROLES.VISOR,
                label: 'Visor',
                level: 1,
                description: 'Solo lectura - Puede ver información pero no modificarla',
                icon: '👁️',
                permissions: PERMISSIONS[ROLES.VISOR]
            },
            {
                value: ROLES.EDITOR,
                label: 'Editor',
                level: 2,
                description: 'Puede ver, crear y editar - No puede eliminar',
                icon: '✏️',
                permissions: PERMISSIONS[ROLES.EDITOR]
            },
            {
                value: ROLES.ADMIN,
                label: 'Administrador',
                level: 3,
                description: 'Acceso completo - Puede realizar todas las operaciones',
                icon: '🔐',
                permissions: PERMISSIONS[ROLES.ADMIN]
            }
        ]
    });
});

// ============================================
// GET /api/permissions/check - Verificar permiso específico
// ============================================
router.get('/check', authenticateToken, (req, res) => {
    const { resource, action } = req.query;

    if (!resource || !action) {
        return res.status(400).json({
            success: false,
            error: 'Se requieren los parámetros: resource y action'
        });
    }

    const userRole = req.user.role;
    const hasAccess = PERMISSIONS[userRole]?.[resource]?.includes(action) || false;

    res.json({
        success: true,
        hasPermission: hasAccess,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: userRole
        },
        checked: {
            resource,
            action
        }
    });
});

// ============================================
// GET /api/permissions/matrix - Matriz completa de permisos
// ============================================
router.get('/matrix', authenticateToken, (req, res) => {
    // Construir matriz de permisos
    const resources = ['employees', 'equipment', 'assignments', 'locations', 'departments', 'users', 'reports', 'settings'];
    const actions = ['read', 'create', 'update', 'delete'];

    const matrix = {};

    for (const role of Object.values(ROLES)) {
        matrix[role] = {};
        for (const resource of resources) {
            matrix[role][resource] = {};
            for (const action of actions) {
                matrix[role][resource][action] = PERMISSIONS[role]?.[resource]?.includes(action) || false;
            }
        }
    }

    res.json({
        success: true,
        matrix,
        currentUser: {
            role: req.user.role,
            permissions: PERMISSIONS[req.user.role]
        }
    });
});

module.exports = router;