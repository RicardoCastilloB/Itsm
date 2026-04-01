// ============================================================================
// routes/views.js — Rutas de vistas del sistema
// Orden importante: rutas específicas ANTES que rutas con parámetros (:id)
// ============================================================================

const express    = require('express');
const router     = express.Router();
const { equipmentPool, callStoredProcedure, executeQuery } = require('../config/database');
const {
    authenticateToken,
    requireRole,
    requireVerified,
    logActivity,
    optionalAuth
} = require('../middleware/auth');


// ============================================================================
// RAÍZ — Redirige según autenticación
// ============================================================================
router.get('/', authenticateToken, requireVerified, (req, res) => {
    if (req.user) return res.redirect('/index');
    return res.redirect('/api/auth/login');
});


// ============================================================================
// VISTAS SIMPLES — Sin lógica de BD (render directo)
// ============================================================================
router.get('/home',       (req, res) => res.render('home'));
router.get('/sccm',       (req, res) => res.render('sccm'));

router.get('/import-csv', authenticateToken, (req, res) => {
    res.render('import-csv', { title: 'Importar CSV', user: req.user });
});


// ============================================================================
// INDEX / DASHBOARD PRINCIPAL
// ============================================================================
router.get('/index',
    authenticateToken,
    logActivity('VIEW_DASHBOARD', 'Usuario accedió al index'),
    async (req, res) => {
        try {
            res.render('index', {
                title: 'Dashboard - Equipment Management',
                user:  req.user,
            });
        } catch (error) {
            console.error('Error cargando index:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando dashboard', user: req.user });
        }
    }
);

router.get('/dashboard',
    authenticateToken,
    logActivity('VIEW_DASHBOARD', 'Usuario accedió al dashboard'),
    async (req, res) => {
        try {
            const stats = await callStoredProcedure(equipmentPool, 'sp_dashboard_statistics', []);
            res.render('dashboard', {
                title: 'Dashboard - Equipment Management',
                user:  req.user,
                stats: {
                    employees:         stats[0][0],
                    equipment:         stats[1][0],
                    activeAssignments: stats[2][0],
                    topLocations:      stats[3],
                },
            });
        } catch (error) {
            console.error('Error cargando dashboard:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando dashboard', user: req.user });
        }
    }
);


// ============================================================================
// ANALYTICS
// ============================================================================
router.get('/analytics',
    authenticateToken,
    logActivity('VIEW_ANALYTICS', 'Usuario accedió a Analytics Dashboard'),
    (req, res) => {
        res.render('analytics', { title: 'Analytics Dashboard', user: req.user });
    }
);


// ============================================================================
// INDICATORS
// ============================================================================
router.get('/indicators',
    authenticateToken,
    logActivity('VIEW_INDICATORS', 'Usuario accedió a indicadores'),
    (req, res) => {
        res.render('indicators', { title: 'Indicadores y Reportes', user: req.user });
    }
);


// ============================================================================
// WARRANTY
// ============================================================================
router.get('/warranty', authenticateToken, (req, res) => {
    res.render('warranty', { title: 'Garantías', user: req.user });
});


// ============================================================================
// ACTIVE DIRECTORY
// ============================================================================
router.get('/ad', authenticateToken, (req, res) => {
    res.render('ad', { title: 'Soporte Técnico — Active Directory', user: req.user });
});

router.get('/soporte', authenticateToken, (req, res) => {
    res.render('soporte', { title: 'Soporte Técnico — Active Directory', user: req.user });
});


// ============================================================================
// RECUPERO DE EQUIPOS
// ============================================================================
router.get('/recoveries', authenticateToken, (req, res) => {
    res.render('recoveries', { title: 'Recupero de Equipos', user: req.user });
});


// ============================================================================
// ALMACÉN
// ============================================================================
router.get('/almacen', authenticateToken, (req, res) => {
    res.render('almacen', { title: 'Almacén de Equipos', user: req.user });
});


// ============================================================================
// PERFIL DE USUARIO
// ============================================================================
router.get('/profile',
    authenticateToken,
    logActivity('VIEW_PROFILE', 'Usuario accedió a su perfil'),
    (req, res) => {
        res.render('profile', { title: 'Mi Perfil', user: req.user });
    }
);

router.get('/permissions', authenticateToken, (req, res) => {
    res.render('permissions', { title: 'Mis Permisos', user: req.user });
});


// ============================================================================
// ASIGNACIONES
// ============================================================================
router.get('/assignments',
    authenticateToken,
    logActivity('VIEW_ASSIGNMENTS', 'Usuario accedió a lista de asignaciones'),
    async (req, res) => {
        try {
            const assignments = await executeQuery(
                equipmentPool,
                'SELECT * FROM active_assignments_view ORDER BY assignment_date DESC'
            );
            res.render('assignments/listee', {
                title:       'Asignaciones Activas',
                user:        req.user,
                assignments,
            });
        } catch (error) {
            console.error('Error cargando asignaciones:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando asignaciones', user: req.user });
        }
    }
);

router.get('/almacen', authenticateToken, (req, res) => {
    res.render('almacen_recoveries', { title: 'Almacén & Recuperos', user: req.user });
});
// ============================================================================
// REPORTES
router.get('/send-reports', authenticateToken, (req, res) =>
  res.render('send-reports', { title: 'Envío de Reportes', user: req.user })
);
router.get('/print-queue', (req, res) => res.render('print-queue'));
// ============================================================================

router.get('/report-lists', authenticateToken, (req, res) =>
  res.render('report-lists', { title: 'Listas de Distribución', user: req.user })
);
router.get('/reports-distribution', (req, res) => res.render('reports-distribution'));
router.get('/reports',
    authenticateToken,
    logActivity('VIEW_REPORTS', 'Usuario accedió a reportes'),
    async (req, res) => {
        try {
            const startDate  = req.query.start_date || '';
            const endDate    = req.query.end_date   || '';
            const reportType = req.query.type       || 'assignments';
            let results      = [];

            if (startDate && endDate) {
                if (reportType === 'assignments') {
                    results = await executeQuery(equipmentPool, `
                        SELECT a.*, e.full_name AS employee_name,
                               eq.device_code, eq.brand, eq.model, l.location_name
                        FROM assignments a
                        INNER JOIN employees  e  ON a.employee_id  = e.id
                        INNER JOIN equipment  eq ON a.equipment_id = eq.id
                        LEFT  JOIN locations  l  ON a.location_id  = l.id
                        WHERE a.assignment_date BETWEEN ? AND ?
                        ORDER BY a.assignment_date DESC
                    `, [startDate, endDate]);
                } else if (reportType === 'equipment') {
                    results = await executeQuery(equipmentPool,
                        'SELECT * FROM equipment WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC',
                        [startDate, endDate]
                    );
                }
            }

            res.render('reports/index', {
                title:   'Reportes',
                user:    req.user,
                results,
                filters: { startDate, endDate, reportType },
            });
        } catch (error) {
            console.error('Error generando reporte:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error generando reporte', user: req.user });
        }
    }
);


// ============================================================================
// ADMIN
// ============================================================================
router.get('/admin',
    authenticateToken,
    requireRole('administrador'),
    logActivity('VIEW_ADMIN', 'Usuario accedió al panel de administración'),
    async (req, res) => {
        try {
            const [users, loginStats] = await Promise.all([
                executeQuery(equipmentPool,
                    'SELECT id, username, email, full_name, role, is_active, is_verified, created_at, last_login FROM users ORDER BY created_at DESC'
                ),
                executeQuery(equipmentPool, `
                    SELECT DATE(attempted_at) AS date,
                           COUNT(*)           AS total_attempts,
                           SUM(status = 'success') AS successful,
                           SUM(status = 'failed')  AS failed
                    FROM login_attempts
                    WHERE attempted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                    GROUP BY DATE(attempted_at)
                    ORDER BY date DESC
                `),
            ]);

            res.render('admin/index', {
                title: 'Panel de Administración',
                user:  req.user,
                users,
                loginStats,
            });
        } catch (error) {
            console.error('Error cargando panel admin:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando panel de administración', user: req.user });
        }
    }
);


// ============================================================================
// EQUIPOS — lista y detalle
// IMPORTANTE: estas rutas van DESPUÉS de todas las rutas sin parámetro
// para evitar que /equipment/:id capture rutas como /almacen, /recoveries, etc.
// ============================================================================
router.get('/equipment',
    authenticateToken,
    logActivity('VIEW_EQUIPMENT', 'Usuario accedió a lista de equipos'),
    async (req, res) => {
        try {
            const { status = '', brand = '', search = '' } = req.query;

            let sql    = 'SELECT * FROM equipment WHERE 1=1';
            const params = [];

            if (status) { sql += ' AND status = ?';          params.push(status); }
            if (brand)  { sql += ' AND brand LIKE ?';        params.push(`%${brand}%`); }
            if (search) {
                sql += ' AND (device_code LIKE ? OR model LIKE ? OR serial_number LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            sql += ' ORDER BY created_at DESC LIMIT 100';

            const [equipment, brands] = await Promise.all([
                executeQuery(equipmentPool, sql, params),
                executeQuery(equipmentPool, 'SELECT DISTINCT brand FROM equipment ORDER BY brand'),
            ]);

            res.render('equipment', {
                title:   'Gestión de Equipos',
                user:    req.user,
                equipment,
                brands,
                filters: { status, brand, search },
            });
        } catch (error) {
            console.error('Error cargando equipos:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando equipos', user: req.user });
        }
    }
);

router.get('/equipment/:id',
    authenticateToken,
    logActivity('VIEW_EQUIPMENT_DETAIL', 'Usuario vio detalle de equipo'),
    async (req, res) => {
        try {
            const equipment = await executeQuery(equipmentPool,
                'SELECT * FROM equipment WHERE id = ?', [req.params.id]
            );
            if (!equipment.length) {
                return res.status(404).render('error', { title: 'Error', error: 'Equipo no encontrado', user: req.user });
            }
            const history = await callStoredProcedure(equipmentPool, 'sp_get_equipment_history', [req.params.id]);
            res.render('equipment/view', {
                title:     'Detalle de Equipo',
                user:      req.user,
                equipment: equipment[0],
                history:   history[0],
            });
        } catch (error) {
            console.error('Error cargando equipo:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando equipo', user: req.user });
        }
    }
);


// ============================================================================
// EMPLEADOS — lista, perfil y detalle
// IMPORTANTE: /employees/perfil va ANTES de /employees/:id
// para que no sea capturada como id = "perfil"
// ============================================================================
router.get('/employees',
    authenticateToken,
    logActivity('VIEW_EMPLOYEES', 'Usuario accedió a lista de empleados'),
    async (req, res) => {
        try {
            const page   = parseInt(req.query.page) || 1;
            const limit  = 10;
            const offset = (page - 1) * limit;
            const search = req.query.search || '';

            let sql    = 'SELECT * FROM employees WHERE is_active = TRUE';
            const params = [];

            if (search) {
                sql += ' AND (full_name LIKE ? OR email LIKE ? OR cip LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            sql += ' ORDER BY full_name LIMIT ? OFFSET ?';
            params.push(limit, offset);

            const [employees, totalResult] = await Promise.all([
                executeQuery(equipmentPool, sql, params),
                executeQuery(equipmentPool, 'SELECT COUNT(*) AS total FROM employees WHERE is_active = TRUE'),
            ]);

            res.render('employees', {
                title:       'Empleados',
                user:        req.user,
                employees,
                currentPage: page,
                totalPages:  Math.ceil(totalResult[0].total / limit),
                search,
            });
        } catch (error) {
            console.error('Error cargando empleados:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando empleados', user: req.user });
        }
    }
);

// Perfil de empleado — debe estar ANTES de /:id
router.get('/empleados/perfil', authenticateToken, (req, res) => {
    res.render('employees-profile', { user: req.user });
});

router.get('/employees/:id',
    authenticateToken,
    logActivity('VIEW_EMPLOYEE_DETAIL', 'Usuario vio detalle de empleado'),
    async (req, res) => {
        try {
            const results = await callStoredProcedure(equipmentPool, 'sp_get_employee_by_id', [req.params.id]);
            if (!results[0] || !results[0].length) {
                return res.status(404).render('error', { title: 'Error', error: 'Empleado no encontrado', user: req.user });
            }
            const history = await callStoredProcedure(equipmentPool, 'sp_get_assignment_history', [req.params.id]);
            res.render('employees/view', {
                title:       'Detalle de Empleado',
                user:        req.user,
                employee:    results[0][0],
                assignments: history[0],
            });
        } catch (error) {
            console.error('Error cargando empleado:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando empleado', user: req.user });
        }
    }
);


// GET /incidencias
router.get('/incidencias', authenticateToken, requireVerified, (req, res) => {
    res.render('incidencias', { title: 'Gestión de Tickets', user: req.user });
});

// ============================================================================
// ITSM EXTENDIDO
// ============================================================================
router.get('/solicitudes', authenticateToken, requireVerified, (req, res) => {
    res.render('solicitudes', { title: 'Solicitudes de Servicio', user: req.user });
});

router.get('/cambios', authenticateToken, requireVerified, (req, res) => {
    res.render('cambios', { title: 'Gestión de Cambios', user: req.user });
});

router.get('/problemas', authenticateToken, requireVerified, (req, res) => {
    res.render('problemas', { title: 'Gestión de Problemas', user: req.user });
});

router.get('/catalogo', authenticateToken, requireVerified, (req, res) => {
    res.render('catalogo', { title: 'Catálogo de Servicios', user: req.user });
});

router.get('/cmdb', authenticateToken, requireVerified, (req, res) => {
    res.render('cmdb', { title: 'CMDB — Inventario de Configuración', user: req.user });
});

// ============================================================================
// FASE 4 — SOPORTE Y CONOCIMIENTO
// ============================================================================
router.get('/agent-dashboard', authenticateToken, requireVerified, (req, res) => {
    res.render('agent-dashboard', { title: 'Mi Dashboard', user: req.user });
});

router.get('/admin-dashboard', authenticateToken, requireRole('administrador'), (req, res) => {
    res.render('admin-dashboard', { title: 'Dashboard Administrador', user: req.user });
});

router.get('/knowledge-base', authenticateToken, requireVerified, (req, res) => {
    res.render('knowledge-base', { title: 'Base de Conocimiento', user: req.user });
});

router.get('/csi', authenticateToken, requireVerified, (req, res) => {
    res.render('csi', { title: 'Mejora Continua (CSI)', user: req.user });
});

router.get('/reports-itsm', authenticateToken, requireVerified, (req, res) => {
    res.render('reports-itsm', { title: 'Reportes ITSM', user: req.user });
});

// ============================================================================
// FASE 5-6 — PORTAL AUTOSERVICIO + ADMIN REGLAS
// ============================================================================

// Portal de autoservicio (rol usuario / cualquier rol)
router.get('/portal', authenticateToken, requireVerified, (req, res) => {
    res.render('user/portal', { title: 'Portal de Autoservicio', user: req.user });
});

router.get('/portal/tickets', authenticateToken, requireVerified, (req, res) => {
    res.render('user/portal', { title: 'Mis Tickets', user: req.user });
});

router.get('/portal/ticket/:id', authenticateToken, requireVerified, (req, res) => {
    res.render('user/mi-ticket', { title: 'Detalle de Ticket', user: req.user, ticketId: req.params.id });
});

// Admin: motor de reglas
router.get('/admin/reglas', authenticateToken, requireRole('administrador'), (req, res) => {
    res.render('admin/reglas', { title: 'Motor de Reglas', user: req.user });
});

// ============================================================================
// EXPORTAR
// ============================================================================
module.exports = router;
