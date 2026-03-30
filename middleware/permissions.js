// middleware/permissions.js - Sistema de control de acceso basado en roles

const { executeQuery, equipmentPool } = require('../config/database');

// ============================================
// DEFINICIÓN DE ROLES Y PERMISOS
// ============================================

const ROLES = {
    ADMIN: 'administrador',
    EDITOR: 'editor',
    VISOR: 'visor'
};

// Definir qué puede hacer cada rol
const PERMISSIONS = {
    [ROLES.ADMIN]: {
        employees: ['read', 'create', 'update', 'delete'],
        equipment: ['read', 'create', 'update', 'delete'],
        assignments: ['read', 'create', 'update', 'delete'],
        locations: ['read', 'create', 'update', 'delete'],
        departments: ['read', 'create', 'update', 'delete'],
        users: ['read', 'create', 'update', 'delete'],
        reports: ['read', 'export'],
        settings: ['read', 'update']
    },
    [ROLES.EDITOR]: {
        employees: ['read', 'create', 'update'],
        equipment: ['read', 'create', 'update'],
        assignments: ['read', 'create', 'update'],
        locations: ['read', 'create', 'update'],
        departments: ['read', 'create', 'update'],
        users: ['read'], // Solo ver usuarios, no modificar
        reports: ['read', 'export'],
        settings: ['read'] // Solo ver configuración
    },
    [ROLES.VISOR]: {
        employees: ['read'],
        equipment: ['read'],
        assignments: ['read'],
        locations: ['read'],
        departments: ['read'],
        users: [], // No puede ver usuarios
        reports: ['read'], // Puede ver reportes pero no exportar
        settings: [] // No puede ver configuración
    }
};

// ============================================
// Función: Verificar si un rol tiene permiso específico
// ============================================
function hasPermission(role, resource, action) {
    if (!PERMISSIONS[role]) {
        console.log(`⚠️ Rol no reconocido: ${role}`);
        return false;
    }

    if (!PERMISSIONS[role][resource]) {
        console.log(`⚠️ Recurso no definido para rol ${role}: ${resource}`);
        return false;
    }

    const allowed = PERMISSIONS[role][resource].includes(action);
    console.log(`🔍 Permiso ${role} -> ${resource}.${action}: ${allowed ? '✅' : '❌'}`);
    return allowed;
}

// ============================================
// Middleware: Verificar permiso para recurso específico
// ============================================
function checkPermission(resource, action) {
    return (req, res, next) => {
        // Verificar que el usuario esté autenticado
        if (!req.user) {
            console.log('⚠️ checkPermission: Usuario no autenticado');
            
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({
                    success: false,
                    error: 'No autenticado'
                });
            }
            
            return res.redirect('/api/auth/login');
        }

        const userRole = req.user.role;
        
        // Verificar permiso
        if (!hasPermission(userRole, resource, action)) {
            console.log(`⛔ Permiso denegado: ${req.user.username} (${userRole}) intentó ${action} en ${resource}`);
            
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({
                    success: false,
                    error: `No tienes permisos para ${action === 'read' ? 'ver' : action === 'create' ? 'crear' : action === 'update' ? 'editar' : 'eliminar'} ${resource}`,
                    requiredPermission: `${resource}.${action}`,
                    userRole: userRole
                });
            }
            
            return res.status(403).send(`
                <html>
                <head>
                    <title>Acceso Denegado</title>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .error-box {
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            text-align: center;
                            max-width: 500px;
                        }
                        h1 { color: #dc3545; margin-bottom: 20px; }
                        p { color: #666; margin-bottom: 15px; }
                        .permission-box {
                            background: #f8d7da;
                            padding: 15px;
                            border-radius: 10px;
                            margin: 20px 0;
                            color: #721c24;
                        }
                        .btn {
                            display: inline-block;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 10px;
                            margin-top: 20px;
                            transition: transform 0.2s;
                        }
                        .btn:hover { transform: translateY(-2px); }
                    </style>
                </head>
                <body>
                    <div class="error-box">
                        <h1>⛔ Acceso Denegado</h1>
                        <p>No tienes permisos suficientes para realizar esta acción.</p>
                        <div class="permission-box">
                            <strong>Tu rol:</strong> ${userRole}<br>
                            <strong>Acción requerida:</strong> ${action} en ${resource}<br>
                            <strong>Permisos disponibles:</strong> ${PERMISSIONS[userRole][resource]?.join(', ') || 'Ninguno'}
                        </div>
                        <a href="/dashboard" class="btn">← Volver al Dashboard</a>
                    </div>
                </body>
                </html>
            `);
        }

        console.log(`✅ Permiso concedido: ${req.user.username} (${userRole}) puede ${action} en ${resource}`);
        next();
    };
}

// ============================================
// Middleware: Verificar permisos por método HTTP
// ============================================
function checkMethodPermission(resource) {
    return (req, res, next) => {
        if (!req.user) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({
                    success: false,
                    error: 'No autenticado'
                });
            }
            return res.redirect('/api/auth/login');
        }

        // Mapear métodos HTTP a acciones
        const methodToAction = {
            'GET': 'read',
            'POST': 'create',
            'PUT': 'update',
            'PATCH': 'update',
            'DELETE': 'delete'
        };

        const action = methodToAction[req.method];
        
        if (!action) {
            return res.status(405).json({
                success: false,
                error: 'Método no permitido'
            });
        }

        // Verificar permiso
        if (!hasPermission(req.user.role, resource, action)) {
            console.log(`⛔ Permiso denegado: ${req.user.username} (${req.user.role}) intentó ${req.method} en ${resource}`);
            
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({
                    success: false,
                    error: `No tienes permisos para ${action} en ${resource}`,
                    method: req.method,
                    requiredPermission: `${resource}.${action}`,
                    userRole: req.user.role
                });
            }
            
            return res.status(403).send(`
                <html>
                <head>
                    <title>Acceso Denegado</title>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .error-box {
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            text-align: center;
                            max-width: 500px;
                        }
                        h1 { color: #dc3545; }
                        .btn {
                            display: inline-block;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 10px;
                            margin-top: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="error-box">
                        <h1>⛔ Acceso Denegado</h1>
                        <p>Tu rol (${req.user.role}) no permite esta acción (${req.method}).</p>
                        <a href="/dashboard" class="btn">← Volver al Dashboard</a>
                    </div>
                </body>
                </html>
            `);
        }

        console.log(`✅ Permiso concedido: ${req.user.username} puede ${req.method} en ${resource}`);
        next();
    };
}

// ============================================
// Middleware: Solo Admin
// ============================================
function adminOnly(req, res, next) {
    if (!req.user) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, error: 'No autenticado' });
        }
        return res.redirect('/api/auth/login');
    }

    if (req.user.role !== ROLES.ADMIN) {
        console.log(`⛔ Acceso admin denegado: ${req.user.username} (${req.user.role})`);
        
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                error: 'Solo administradores pueden acceder',
                userRole: req.user.role
            });
        }
        
        return res.status(403).send(`
            <html>
            <head>
                <title>Solo Administradores</title>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .error-box {
                        background: white;
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        text-align: center;
                        max-width: 500px;
                    }
                    h1 { color: #dc3545; }
                    .btn {
                        display: inline-block;
                        padding: 12px 30px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        text-decoration: none;
                        border-radius: 10px;
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <h1>🔐 Solo Administradores</h1>
                    <p>Esta sección requiere privilegios de administrador.</p>
                    <p>Tu rol actual: <strong>${req.user.role}</strong></p>
                    <a href="/dashboard" class="btn">← Volver al Dashboard</a>
                </div>
            </body>
            </html>
        `);
    }

    next();
}

// ============================================
// Middleware: Editor o Admin (puede editar)
// ============================================
function canEdit(req, res, next) {
    if (!req.user) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, error: 'No autenticado' });
        }
        return res.redirect('/api/auth/login');
    }

    const allowedRoles = [ROLES.ADMIN, ROLES.EDITOR];
    
    if (!allowedRoles.includes(req.user.role)) {
        console.log(`⛔ Permiso de edición denegado: ${req.user.username} (${req.user.role})`);
        
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permisos para editar',
                userRole: req.user.role,
                allowedRoles
            });
        }
        
        return res.status(403).send(`
            <html>
            <head><title>Permiso Denegado</title><meta charset="UTF-8"></head>
            <body style="font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div style="background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center;">
                    <h1 style="color: #dc3545;">✏️ Permiso de Edición Requerido</h1>
                    <p>Solo usuarios con rol de <strong>Editor</strong> o <strong>Administrador</strong> pueden editar.</p>
                    <p>Tu rol: <strong>${req.user.role}</strong></p>
                    <a href="/dashboard" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 10px; margin-top: 20px;">← Volver</a>
                </div>
            </body>
            </html>
        `);
    }

    next();
}

// ============================================
// Función: Obtener permisos del usuario actual
// ============================================
function getUserPermissions(req, res) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'No autenticado'
        });
    }

    const userRole = req.user.role;
    const permissions = PERMISSIONS[userRole] || {};

    res.json({
        success: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: userRole,
            full_name: req.user.full_name
        },
        permissions,
        roleInfo: {
            name: userRole,
            level: userRole === ROLES.ADMIN ? 3 : userRole === ROLES.EDITOR ? 2 : 1,
            description: 
                userRole === ROLES.ADMIN ? 'Acceso completo al sistema' :
                userRole === ROLES.EDITOR ? 'Puede crear y editar, pero no eliminar' :
                'Solo lectura (visualización)'
        }
    });
}

// ============================================
// EXPORTAR
// ============================================
module.exports = {
    ROLES,
    PERMISSIONS,
    hasPermission,
    checkPermission,
    checkMethodPermission,
    adminOnly,
    canEdit,
    getUserPermissions
};