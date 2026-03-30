// ============================================================================
// routes/dashboard.js — OPTIMIZADO
// Cambios clave vs versión anterior:
//   • /fast-all      → 1 sola query (antes: 6 subqueries anidadas)
//   • /stats-completo→ 1 sola query (antes: 4 queries separadas)
//   • /historico-asignaciones → query simplificada + parámetro directo
//   • /propios-arrendados → sin cambios (ya era rápida)
//   • Caché en memoria de 5 min para /fast-all (ya existía, se mantiene)
//   • Todos los endpoints nuevos y los no críticos sin cambios
// ============================================================================

const express2      = require('express');
const dashboardRouter = express2.Router(); 
const {
    equipmentPool: pool,
    cmdbPool,
    callStoredProcedure: callSP,
    executeQuery: execQuery,
    equipmentPool
} = require('../config/database');

// ============================================================================
// /fast-all — ULTRA RÁPIDO
// ANTES: 1 query con 6 subqueries escalares → lento en tablas grandes
// AHORA: 1 query con COUNT + GROUP en un solo scan usando CASE
// Caché en memoria de 5 min
// ============================================================================
let fastCache = { data: null, timestamp: null };
const CACHE_TTL = 5 * 60 * 1000;

dashboardRouter.get('/fast-all', async (req, res, next) => {
    try {
        const now = Date.now();

        if (fastCache.data && (now - fastCache.timestamp < CACHE_TTL)) {
            return res.json({ success: true, ...fastCache.data, cached: true });
        }

        // ✅ UNA sola query — MySQL resuelve todo en un pass
        const [stats] = await execQuery(equipmentPool, `
            SELECT
                COUNT(*)                                                          AS total_equipos,
                SUM(status = 'Asignado')                                          AS asignados,
                SUM(status = 'Disponible')                                        AS disponibles,
                SUM(status = 'Disponible' AND equipment_type = 'Laptop')          AS almacen_laptops,
                SUM(status = 'Disponible' AND equipment_type = 'Desktop')         AS almacen_desktops,
                SUM(status = 'Disponible' AND equipment_type = 'Monitor')         AS almacen_monitores
            FROM equipment
        `);

        // Histórico últimos 6 meses — agrupación simple
        const historico = await execQuery(equipmentPool, `
            SELECT
                DATE_FORMAT(assignment_date, '%Y-%m') AS mes,
                DATE_FORMAT(assignment_date, '%b')    AS mes_nombre,
                COUNT(*)                              AS total
            FROM assignments
            WHERE assignment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(assignment_date, '%Y-%m')
            ORDER BY mes ASC
        `);

        const total               = stats.total_equipos || 0;
        const porcentajeAsignados = total > 0
            ? ((stats.asignados / total) * 100).toFixed(1)
            : 0;

        const responseData = {
            stats: {
                total,
                asignados:            stats.asignados    || 0,
                disponibles:          stats.disponibles  || 0,
                porcentaje_asignados: porcentajeAsignados
            },
            almacen: {
                laptops:   stats.almacen_laptops   || 0,
                desktops:  stats.almacen_desktops  || 0,
                monitores: stats.almacen_monitores || 0
            },
            historico: historico || [],
            timestamp: new Date().toISOString()
        };

        fastCache = { data: responseData, timestamp: now };

        res.json({ success: true, ...responseData, cached: false });

    } catch (error) {
        console.error('❌ /fast-all:', error);
        next(error);
    }
});

// ============================================================================
// /stats-completo — 4 queries → 1 query
// ============================================================================
dashboardRouter.get('/stats-completo', async (req, res, next) => {
    try {
        // ✅ Un solo scan de la tabla
        const [row] = await execQuery(equipmentPool, `
            SELECT
                COUNT(*)                                                                      AS totalEquipos,
                SUM(status = 'Asignado')                                                      AS equiposAsignados,
                SUM(status = 'Disponible')                                                    AS equiposDisponibles,
                SUM(DATE_ADD(created_at, INTERVAL 12 MONTH) > CURDATE()
                    AND status != 'Dado de Baja')                                             AS equiposGarantia
            FROM equipment
        `);

        const total                  = row.totalEquipos || 0;
        const porcentajeAsignados    = total > 0 ? ((row.equiposAsignados   / total) * 100).toFixed(1) : 0;
        const porcentajeDisponibles  = total > 0 ? ((row.equiposDisponibles / total) * 100).toFixed(1) : 0;

        res.json({
            success: true,
            data: {
                totalEquipos:         total,
                equiposAsignados:     row.equiposAsignados    || 0,
                porcentajeAsignados,
                equiposDisponibles:   row.equiposDisponibles  || 0,
                porcentajeDisponibles,
                equiposGarantia:      row.equiposGarantia     || 0,
                mesesPromedioGarantia: 6
            }
        });
    } catch (error) {
        next(error);
    }
});

// ============================================================================
// /propios-arrendados
// ============================================================================
dashboardRouter.get('/propios-arrendados', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                COALESCE(acquisition_type, 'Sin Definir') AS acquisition_type,
                COUNT(*) AS cantidad
            FROM equipment
            GROUP BY COALESCE(acquisition_type, 'Sin Definir')
            ORDER BY cantidad DESC
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

// alias
dashboardRouter.get('/propios-vs-alquilados', (req, res, next) => {
    req.url = '/propios-arrendados';
    dashboardRouter.handle(req, res, next);
});

// ============================================================================
// /historico-asignaciones — simplificado
// CONSEJO: agrega índice → CREATE INDEX idx_asgn_date ON assignments(assignment_date);
// ============================================================================
dashboardRouter.get('/historico-asignaciones', async (req, res, next) => {
    try {
        const periodoMeses = Math.min(parseInt(req.query.meses) || 12, 36); // máximo 36

        const results = await execQuery(equipmentPool, `
            SELECT
                DATE_FORMAT(a.assignment_date, '%Y-%m')  AS mes,
                DATE_FORMAT(a.assignment_date, '%b %Y')  AS mes_nombre,
                YEAR(a.assignment_date)                  AS anio,
                MONTH(a.assignment_date)                 AS mes_num,
                COUNT(DISTINCT a.id)                     AS total_asignaciones,
                SUM(e.equipment_type = 'Laptop')         AS laptops,
                SUM(e.equipment_type = 'Desktop')        AS desktops,
                SUM(e.equipment_type = 'Monitor')        AS monitores,
                SUM(e.equipment_type = 'Tablet')         AS tablets,
                COUNT(DISTINCT a.employee_id)            AS empleados_unicos
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            WHERE a.assignment_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
              AND a.assignment_date <= CURDATE()
            GROUP BY
                DATE_FORMAT(a.assignment_date, '%Y-%m'),
                DATE_FORMAT(a.assignment_date, '%b %Y'),
                YEAR(a.assignment_date),
                MONTH(a.assignment_date)
            ORDER BY anio ASC, mes_num ASC
        `, [periodoMeses]);

        const total           = results.reduce((s, r) => s + r.total_asignaciones, 0);
        const promedioMensual = results.length ? Math.round(total / results.length) : 0;
        const mesPico         = results.length
            ? results.reduce((max, r) => r.total_asignaciones > max.total_asignaciones ? r : max)
            : null;

        res.json({
            success: true,
            data: results,
            estadisticas: {
                total_asignaciones: total,
                promedio_mensual:   promedioMensual,
                meses_analizados:   results.length,
                mes_pico: mesPico ? { mes: mesPico.mes_nombre, cantidad: mesPico.total_asignaciones } : null
            },
            periodo: `Últimos ${periodoMeses} meses`
        });
    } catch (error) {
        console.error('Error historico-asignaciones:', error);
        next(error);
    }
});

// ============================================================================
// /equipos-por-tipo
// ============================================================================
dashboardRouter.get('/equipos-por-tipo', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                equipment_type                                      AS tipo,
                COUNT(*)                                            AS total,
                SUM(status = 'Asignado')                           AS asignados,
                SUM(status = 'Disponible')                         AS disponibles,
                ROUND(SUM(status = 'Asignado') * 100.0 / COUNT(*), 2) AS porcentaje_asignados
            FROM equipment
            GROUP BY equipment_type
            ORDER BY total DESC
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

// ============================================================================
// /equipos-por-ubicacion
// ============================================================================
dashboardRouter.get('/equipos-por-ubicacion', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                COALESCE(l.location_name, 'Sin Ubicación') AS ubicacion,
                COALESCE(l.city, '-')                      AS ciudad,
                COUNT(DISTINCT a.equipment_id)             AS total_equipos,
                SUM(e.equipment_type = 'Laptop')           AS laptops,
                SUM(e.equipment_type = 'Desktop')          AS desktops,
                SUM(e.equipment_type = 'Monitor')          AS monitores,
                SUM(e.equipment_type = 'Tablet')           AS tablets,
                SUM(e.equipment_type NOT IN ('Laptop','Desktop','Monitor','Tablet')) AS otros
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            LEFT  JOIN locations l ON a.location_id  = l.id
            WHERE a.status = 'Activo' AND a.return_date IS NULL
            GROUP BY COALESCE(l.location_name,'Sin Ubicación'), COALESCE(l.city,'-')
            ORDER BY total_equipos DESC
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

// ============================================================================
// /equipos-garantia
// ============================================================================
dashboardRouter.get('/equipos-garantia', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                device_code, equipment_type, brand, model, status,
                created_at AS acquisition_date,
                DATE_ADD(created_at, INTERVAL 12 MONTH) AS warranty_end,
                TIMESTAMPDIFF(DAY, CURDATE(), DATE_ADD(created_at, INTERVAL 12 MONTH)) AS dias_restantes
            FROM equipment
            WHERE DATE_ADD(created_at, INTERVAL 12 MONTH) > CURDATE()
              AND status NOT IN ('Dado de Baja')
            ORDER BY warranty_end ASC
            LIMIT 50
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

// ============================================================================
// /asignaciones-largas
// CONSEJO: índice → CREATE INDEX idx_asgn_status_return ON assignments(status, return_date);
// ============================================================================
dashboardRouter.get('/asignaciones-largas', async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        let where = 'WHERE a.status = \'Activo\' AND a.return_date IS NULL';
        const params = [];

        if (startDate && endDate) {
            where += ' AND a.assignment_date BETWEEN ? AND ?';
            params.push(startDate, endDate);
        }

        const results = await execQuery(equipmentPool, `
            SELECT
                e.device_code,
                e.serial_number,
                e.equipment_type,
                e.brand,
                e.model,
                e.processor,
                e.ram_memory,
                e.disk_capacity,
                e.status,
                e.acquisition_type,
                emp.full_name          AS employee_name,
                emp.cip                AS employee_cip,
                a.assignment_date,
                TIMESTAMPDIFF(DAY, a.assignment_date, CURDATE()) AS dias_asignado,
                l.location_name,
                l.location_name        AS branch_office_id,
                d.department_name
            FROM assignments a
            INNER JOIN equipment   e   ON a.equipment_id  = e.id
            INNER JOIN employees   emp ON a.employee_id   = emp.id
            LEFT  JOIN locations   l   ON a.location_id   = l.id
            LEFT  JOIN departments d   ON a.department_id = d.id
            ${where}
            ORDER BY dias_asignado DESC
            LIMIT 200
        `, params);

        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

// ============================================================================
// /antiguedad-promedio
// ============================================================================
dashboardRouter.get('/antiguedad-promedio', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                equipment_type,
                ROUND(AVG(TIMESTAMPDIFF(MONTH, created_at, CURDATE())) / 12, 2) AS antiguedad_promedio
            FROM equipment
            WHERE status != 'Dado de Baja'
            GROUP BY equipment_type
            ORDER BY antiguedad_promedio DESC
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

// ============================================================================
// /tiempo-asignacion-promedio
// ============================================================================
dashboardRouter.get('/tiempo-asignacion-promedio', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                e.equipment_type,
                COUNT(DISTINCT a.equipment_id)                                       AS equipos_asignados,
                ROUND(AVG(TIMESTAMPDIFF(DAY, a.assignment_date, CURDATE())), 0)      AS dias_promedio,
                ROUND(AVG(TIMESTAMPDIFF(MONTH, a.assignment_date, CURDATE())), 1)    AS meses_promedio,
                MAX(TIMESTAMPDIFF(DAY, a.assignment_date, CURDATE()))                AS asignacion_mas_larga,
                MIN(TIMESTAMPDIFF(DAY, a.assignment_date, CURDATE()))                AS asignacion_mas_corta
            FROM assignments a
            INNER JOIN equipment e ON a.equipment_id = e.id
            WHERE a.status = 'Activo' AND a.return_date IS NULL
            GROUP BY e.equipment_type
            ORDER BY dias_promedio DESC
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

// ============================================================================
// /top-modelos-asignados
// ============================================================================
dashboardRouter.get('/top-modelos-asignados', async (req, res, next) => {
    try {
        const { tipo } = req.query;
        const limite   = Math.min(parseInt(req.query.limite) || 20, 50);

        const params = [];
        let tipoWhere = '';
        if (tipo) {
            tipoWhere = 'AND e.equipment_type = ?';
            params.push(tipo);
        }
        params.push(limite);

        const results = await execQuery(equipmentPool, `
            SELECT
                e.brand                                          AS marca,
                e.model                                          AS modelo,
                e.equipment_type                                 AS tipo_equipo,
                COUNT(DISTINCT a.equipment_id)                   AS cantidad_asignada,
                ROUND(COUNT(DISTINCT a.equipment_id) * 100.0 /
                    NULLIF((SELECT COUNT(DISTINCT equipment_id)
                            FROM assignments
                            WHERE status='Activo' AND return_date IS NULL), 0), 2) AS porcentaje_total,
                ROUND(AVG(TIMESTAMPDIFF(MONTH, e.created_at, CURDATE())) / 12, 1) AS antiguedad_promedio_anos
            FROM equipment e
            INNER JOIN assignments a ON e.id = a.equipment_id
            WHERE a.status = 'Activo' AND a.return_date IS NULL
            ${tipoWhere}
            GROUP BY e.brand, e.model, e.equipment_type
            ORDER BY cantidad_asignada DESC
            LIMIT ?
        `, params);

        res.json({
            success: true,
            data: results,
            estadisticas: {
                total_modelos:            results.length,
                total_equipos_asignados:  results.reduce((s, r) => s + r.cantidad_asignada, 0),
                modelo_mas_usado:         results[0] || null
            }
        });
    } catch (error) { next(error); }
});

// ============================================================================
// /stats — stored procedure (sin cambios)
// ============================================================================
dashboardRouter.get('/stats', async (req, res, next) => {
    try {
        const results = await callSP(equipmentPool, 'sp_dashboard_statistics', []);
        res.json({
            success: true,
            data: {
                employees:        results[0][0],
                equipment:        results[1][0],
                activeAssignments: results[2][0],
                topLocations:     results[3]
            }
        });
    } catch (error) { next(error); }
});

// ============================================================================
// /stats-only — caché
// ============================================================================
dashboardRouter.get('/stats-only', async (req, res, next) => {
    try {
        const [stats] = await execQuery(equipmentPool,
            'SELECT * FROM dashboard_stats_cache WHERE id = 1'
        );
        res.json({
            success: true,
            stats: {
                totalEmployees:   stats.total_employees,
                totalEquipment:   stats.total_equipment,
                totalAssignments: stats.total_assignments,
                totalDepartments: stats.total_departments,
                totalLocations:   stats.total_locations
            }
        });
    } catch (error) { next(error); }
});

// ============================================================================
// Resto de endpoints sin cambios (no críticos para el dashboard principal)
// ============================================================================

dashboardRouter.get('/equipment-by-brand', async (req, res, next) => {
    try {
        const results = await callSP(pool, 'sp_report_equipment_by_brand', []);
        res.json({ success: true, data: results[0] });
    } catch (error) { next(error); }
});

dashboardRouter.get('/employees-without-equipment', async (req, res, next) => {
    try {
        const results = await callSP(pool, 'sp_report_employees_without_equipment', []);
        res.json({ success: true, data: results[0], count: results[0].length });
    } catch (error) { next(error); }
});

dashboardRouter.get('/activos-cmdb-stats', async (req, res, next) => {
    try {
        const [total, byStatus, byManufacturer, byLocation] = await Promise.all([
            execQuery(cmdbPool, 'SELECT COUNT(*) as total FROM activos'),
            execQuery(cmdbPool, 'SELECT Estado, COUNT(*) as count FROM activos GROUP BY Estado'),
            execQuery(cmdbPool, 'SELECT Fabricante, COUNT(*) as count FROM activos WHERE Fabricante IS NOT NULL GROUP BY Fabricante ORDER BY count DESC LIMIT 10'),
            execQuery(cmdbPool, 'SELECT Localidad, COUNT(*) as count FROM activos WHERE Localidad IS NOT NULL GROUP BY Localidad ORDER BY count DESC LIMIT 10')
        ]);
        res.json({ success: true, data: { total: total[0].total, byStatus, topManufacturers: byManufacturer, topLocations: byLocation } });
    } catch (error) { next(error); }
});

dashboardRouter.get('/planilla-stats', async (req, res, next) => {
    try {
        const [total, byOrg, byLocation] = await Promise.all([
            execQuery(cmdbPool, 'SELECT COUNT(*) as total FROM planilla'),
            execQuery(cmdbPool, 'SELECT Nombre_unidad_org, COUNT(*) as count FROM planilla WHERE Nombre_unidad_org IS NOT NULL GROUP BY Nombre_unidad_org ORDER BY count DESC LIMIT 10'),
            execQuery(cmdbPool, 'SELECT Nombre_lugar_trabajo, COUNT(*) as count FROM planilla WHERE Nombre_lugar_trabajo IS NOT NULL GROUP BY Nombre_lugar_trabajo ORDER BY count DESC LIMIT 10')
        ]);
        res.json({ success: true, data: { totalEmployees: total[0].total, byOrganization: byOrg, byWorkLocation: byLocation } });
    } catch (error) { next(error); }
});

dashboardRouter.get('/equipos-sin-asignar', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                e.device_code, e.equipment_type, e.brand, e.model, e.status, e.created_at,
                TIMESTAMPDIFF(DAY, e.created_at, CURDATE()) AS dias_sin_uso,
                DATE_ADD(e.created_at, INTERVAL 12 MONTH) AS warranty_end,
                IF(DATE_ADD(e.created_at, INTERVAL 12 MONTH) > CURDATE(), 'En Garantía', 'Fuera de Garantía') AS estado_garantia
            FROM equipment e
            WHERE e.status = 'Disponible'
              AND e.id NOT IN (
                  SELECT equipment_id FROM assignments
                  WHERE status = 'Activo' AND return_date IS NULL
              )
            ORDER BY dias_sin_uso DESC
            LIMIT 100
        `);
        res.json({ success: true, data: results, count: results.length });
    } catch (error) { next(error); }
});

dashboardRouter.get('/alertas-garantia', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                e.device_code, e.equipment_type, e.brand, e.model, e.status,
                DATE_ADD(e.created_at, INTERVAL 12 MONTH) AS warranty_end,
                TIMESTAMPDIFF(DAY, CURDATE(), DATE_ADD(e.created_at, INTERVAL 12 MONTH)) AS dias_restantes,
                emp.full_name AS asignado_a, l.location_name
            FROM equipment e
            LEFT JOIN assignments a  ON e.id = a.equipment_id AND a.status='Activo' AND a.return_date IS NULL
            LEFT JOIN employees  emp ON a.employee_id = emp.id
            LEFT JOIN locations  l   ON a.location_id = l.id
            WHERE DATE_ADD(e.created_at, INTERVAL 12 MONTH) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
              AND e.status != 'Dado de Baja'
            ORDER BY warranty_end ASC
        `);
        res.json({
            success: true, data: results, count: results.length,
            message: results.length > 0
                ? `⚠️ ${results.length} equipos vencen en 30 días`
                : '✅ Sin equipos por vencer'
        });
    } catch (error) { next(error); }
});

dashboardRouter.get('/resumen-ejecutivo', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT 'Total Equipos' AS metrica, COUNT(*) AS valor, NULL AS detalle FROM equipment
            UNION ALL
            SELECT 'Equipos Asignados',
                   SUM(status='Asignado'),
                   CONCAT(ROUND(SUM(status='Asignado')*100.0/COUNT(*),1),'%')
            FROM equipment
            UNION ALL
            SELECT 'Equipos Disponibles',
                   SUM(status='Disponible'),
                   CONCAT(ROUND(SUM(status='Disponible')*100.0/COUNT(*),1),'%')
            FROM equipment
            UNION ALL
            SELECT 'Asignaciones Activas', COUNT(*), NULL
            FROM assignments WHERE status='Activo' AND return_date IS NULL
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

dashboardRouter.get('/top-modelos-por-tipo/:tipo', async (req, res, next) => {
    try {
        const { tipo } = req.params;
        const limite   = Math.min(parseInt(req.query.limite) || 10, 30);
        const results  = await execQuery(equipmentPool, `
            SELECT
                e.brand AS marca, e.model AS modelo,
                COUNT(DISTINCT a.equipment_id) AS cantidad,
                ROUND(COUNT(DISTINCT a.equipment_id)*100.0/
                    NULLIF((SELECT COUNT(DISTINCT a2.equipment_id)
                            FROM assignments a2
                            INNER JOIN equipment e2 ON a2.equipment_id=e2.id
                            WHERE a2.status='Activo' AND a2.return_date IS NULL
                              AND e2.equipment_type=?),0),2) AS porcentaje_del_tipo
            FROM equipment e
            INNER JOIN assignments a ON e.id=a.equipment_id
            WHERE a.status='Activo' AND a.return_date IS NULL AND e.equipment_type=?
            GROUP BY e.brand, e.model
            ORDER BY cantidad DESC
            LIMIT ?
        `, [tipo, tipo, limite]);
        res.json({ success: true, tipo_equipo: tipo, data: results, count: results.length });
    } catch (error) { next(error); }
});

dashboardRouter.get('/departamentos-stats', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                COALESCE(d.department_name,'Sin Departamento') AS departamento,
                COALESCE(d.division,'-')                       AS division,
                COUNT(DISTINCT a.equipment_id)                 AS total_equipos,
                COUNT(DISTINCT a.employee_id)                  AS total_empleados,
                SUM(e.equipment_type='Laptop')                 AS laptops,
                SUM(e.equipment_type='Desktop')                AS desktops,
                SUM(e.equipment_type='Monitor')                AS monitores
            FROM assignments a
            INNER JOIN equipment  e ON a.equipment_id  = e.id
            LEFT  JOIN departments d ON a.department_id = d.id
            WHERE a.status='Activo' AND a.return_date IS NULL
            GROUP BY COALESCE(d.department_name,'Sin Departamento'), COALESCE(d.division,'-')
            HAVING total_equipos > 0
            ORDER BY total_equipos DESC
            LIMIT 20
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

dashboardRouter.get('/historial-asignaciones/:equipment_id', async (req, res, next) => {
    try {
        const { equipment_id } = req.params;
        const [equipment, history] = await Promise.all([
            execQuery(equipmentPool, 'SELECT * FROM equipment WHERE id=?', [equipment_id]),
            execQuery(equipmentPool, `
                SELECT a.id, a.assignment_date, a.return_date, a.status, a.notes,
                    TIMESTAMPDIFF(DAY,a.assignment_date,COALESCE(a.return_date,CURDATE())) AS dias_asignado,
                    emp.full_name AS employee_name, emp.cip AS employee_cip,
                    d.department_name, l.location_name
                FROM assignments a
                INNER JOIN employees emp ON a.employee_id=emp.id
                LEFT  JOIN departments d ON a.department_id=d.id
                LEFT  JOIN locations   l ON a.location_id=l.id
                WHERE a.equipment_id=?
                ORDER BY a.assignment_date DESC
            `, [equipment_id])
        ]);
        res.json({
            success: true,
            equipment: equipment[0],
            history,
            totalAssignments: history.length,
            currentAssignment: history.find(a => a.status==='Activo' && !a.return_date)
        });
    } catch (error) { next(error); }
});

dashboardRouter.get('/top-empleados-equipos', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                emp.id, emp.full_name, emp.cip, emp.email, emp.position_name,
                COUNT(DISTINCT a.equipment_id) AS total_equipos,
                GROUP_CONCAT(DISTINCT e.equipment_type ORDER BY e.equipment_type SEPARATOR ', ') AS tipos_equipos,
                d.department_name, l.location_name
            FROM employees emp
            INNER JOIN assignments a ON emp.id=a.employee_id
            INNER JOIN equipment   e ON a.equipment_id=e.id
            LEFT  JOIN departments d ON a.department_id=d.id
            LEFT  JOIN locations   l ON a.location_id=l.id
            WHERE a.status='Activo' AND a.return_date IS NULL
            GROUP BY emp.id, emp.full_name, emp.cip, emp.email, emp.position_name, d.department_name, l.location_name
            HAVING total_equipos > 1
            ORDER BY total_equipos DESC
            LIMIT 20
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

dashboardRouter.get('/metricas-tiempo-real', async (req, res, next) => {
    try {
        // ✅ Un solo scan
        const [row] = await execQuery(equipmentPool, `
            SELECT
                SUM(status != 'Dado de Baja')                                AS totalEquipos,
                SUM(status = 'En Reparación')                                AS enReparacion,
                SUM(DATE_ADD(created_at, INTERVAL 12 MONTH) BETWEEN CURDATE()
                    AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
                    AND status != 'Dado de Baja')                            AS alertasGarantia,
                SUM(TIMESTAMPDIFF(YEAR, created_at, CURDATE()) >= COALESCE(obsolescence_years,5)
                    AND status != 'Dado de Baja')                            AS obsoletos
            FROM equipment
        `);
        const [asigHoy]    = await execQuery(equipmentPool, `SELECT COUNT(*) AS v FROM assignments WHERE DATE(assignment_date)=CURDATE() AND status='Activo'`);
        const [devHoy]     = await execQuery(equipmentPool, `SELECT COUNT(*) AS v FROM assignments WHERE DATE(return_date)=CURDATE()`);
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            metricas: {
                totalEquipos:     row.totalEquipos    || 0,
                asignadosHoy:     asigHoy.v           || 0,
                devueltosHoy:     devHoy.v            || 0,
                enReparacion:     row.enReparacion    || 0,
                alertasGarantia:  row.alertasGarantia || 0,
                obsoletos:        row.obsoletos       || 0
            }
        });
    } catch (error) { next(error); }
});

dashboardRouter.get('/valor-inventario', async (req, res, next) => {
    try {
        const results = await execQuery(equipmentPool, `
            SELECT
                equipment_type, acquisition_type,
                COUNT(*)                                              AS cantidad,
                SUM(status='Asignado')                               AS asignados,
                SUM(status='Disponible')                             AS disponibles,
                ROUND(AVG(TIMESTAMPDIFF(YEAR,created_at,CURDATE())),1) AS antiguedad_promedio
            FROM equipment
            WHERE status != 'Dado de Baja'
            GROUP BY equipment_type, acquisition_type
            ORDER BY equipment_type, cantidad DESC
        `);
        res.json({ success: true, data: results });
    } catch (error) { next(error); }
});

dashboardRouter.get('/advanced-search', async (req, res, next) => {
    try {
        const { term } = req.query;
        if (!term) return res.status(400).json({ success: false, error: 'Parámetro requerido' });
        const t = `%${term}%`;
        const [employees, equipment, activos] = await Promise.all([
            execQuery(pool,     `SELECT id, full_name as name, email, 'employee' as type FROM employees WHERE full_name LIKE ? OR email LIKE ? LIMIT 10`, [t,t]),
            execQuery(pool,     `SELECT id, device_code as name, brand, model, 'equipment' as type FROM equipment WHERE device_code LIKE ? OR brand LIKE ? OR model LIKE ? LIMIT 10`, [t,t,t]),
            execQuery(cmdbPool, `SELECT id, \`﻿Nombre_del_CI\` as name, Estado as status, 'activo_cmdb' as type FROM activos WHERE \`﻿Nombre_del_CI\` LIKE ? LIMIT 10`, [t])
        ]);
        res.json({ success: true, data: { employees, equipment, activos_cmdb: activos }, totalResults: employees.length+equipment.length+activos.length });
    } catch (error) { next(error); }
});

dashboardRouter.get('/search', async (req, res, next) => {
    try {
        const { term, table } = req.query;
        if (!term || term.length < 2) return res.status(400).json({ success: false, error: 'Mín. 2 caracteres' });
        const t = `%${term}%`;
        const results = {};
        if (!table || table === 'employees')
            results.employees = await execQuery(pool, `SELECT * FROM employees WHERE full_name LIKE ? OR email LIKE ? OR cip LIKE ? OR national_id LIKE ? ORDER BY full_name LIMIT 500`, [t,t,t,t]);
        if (!table || table === 'equipment')
            results.equipment = await execQuery(pool, `SELECT * FROM equipment WHERE device_code LIKE ? OR serial_number LIKE ? OR brand LIKE ? OR model LIKE ? ORDER BY device_code LIMIT 500`, [t,t,t,t]);
        if (!table || table === 'assignments')
            results.assignments = await execQuery(pool, `SELECT * FROM active_assignments_view WHERE employee_name LIKE ? OR equipment_code LIKE ? OR employee_cip LIKE ? ORDER BY assignment_date DESC LIMIT 500`, [t,t,t]);
        if (!table || table === 'departments')
            results.departments = await execQuery(pool, `SELECT * FROM departments WHERE (department_name LIKE ? OR division LIKE ?) AND is_active=TRUE ORDER BY department_name LIMIT 500`, [t,t]);
        if (!table || table === 'locations')
            results.locations = await execQuery(pool, `SELECT * FROM locations WHERE (location_name LIKE ? OR city LIKE ? OR state LIKE ?) AND is_active=TRUE ORDER BY location_name LIMIT 500`, [t,t,t]);
        const totalResults = Object.values(results).reduce((s,a) => s+a.length, 0);
        res.json({ success: true, data: results, searchTerm: term, totalResults });
    } catch (error) { next(error); }
});

dashboardRouter.get('/export/:table', async (req, res, next) => {
    try {
        const map = {
            employees:   { q: 'SELECT * FROM employees ORDER BY full_name',                      f: 'empleados' },
            equipment:   { q: 'SELECT * FROM equipment ORDER BY device_code',                    f: 'equipos' },
            assignments: { q: 'SELECT * FROM active_assignments_view ORDER BY assignment_date DESC', f: 'asignaciones' },
            departments: { q: 'SELECT * FROM departments WHERE is_active=TRUE ORDER BY department_name', f: 'departamentos' },
            locations:   { q: 'SELECT * FROM locations WHERE is_active=TRUE ORDER BY location_name',     f: 'ubicaciones' }
        };
        const entry = map[req.params.table];
        if (!entry) return res.status(400).json({ success: false, error: 'Tabla inválida' });
        const data = await execQuery(pool, entry.q);
        res.json({ success: true, data, count: data.length, filename: `${entry.f}_${new Date().toISOString().split('T')[0]}` });
    } catch (error) { next(error); }
});

dashboardRouter.post('/comparar-periodos', async (req, res, next) => {
    try {
        const { startDate1, endDate1, startDate2, endDate2 } = req.body;
        const q = `SELECT COUNT(DISTINCT a.equipment_id) AS equipos_asignados, COUNT(DISTINCT a.employee_id) AS empleados, AVG(TIMESTAMPDIFF(DAY,a.assignment_date,COALESCE(a.return_date,CURDATE()))) AS dias_promedio FROM assignments a WHERE a.assignment_date BETWEEN ? AND ?`;
        const [p1, p2] = await Promise.all([
            execQuery(equipmentPool, q, [startDate1, endDate1]),
            execQuery(equipmentPool, q, [startDate2, endDate2])
        ]);
        res.json({
            success: true,
            periodo1: { fechas: { inicio: startDate1, fin: endDate1 }, stats: p1[0] },
            periodo2: { fechas: { inicio: startDate2, fin: endDate2 }, stats: p2[0] },
            comparacion: {
                diferencia_equipos:   p2[0].equipos_asignados - p1[0].equipos_asignados,
                diferencia_empleados: p2[0].empleados - p1[0].empleados,
                diferencia_dias:      Math.round(p2[0].dias_promedio - p1[0].dias_promedio)
            }
        });
    } catch (error) { next(error); }
});

dashboardRouter.get('/unified', async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const [employees, equipment, assignments, departments, locations, counts] = await Promise.all([
            execQuery(equipmentPool, `SELECT * FROM employees ORDER BY full_name LIMIT ${limit}`),
            execQuery(equipmentPool, `SELECT * FROM equipment ORDER BY device_code LIMIT ${limit}`),
            execQuery(equipmentPool, `SELECT * FROM active_assignments_view ORDER BY assignment_date DESC LIMIT ${limit}`),
            execQuery(equipmentPool, 'SELECT * FROM departments WHERE is_active=TRUE ORDER BY department_name'),
            execQuery(equipmentPool, 'SELECT * FROM locations WHERE is_active=TRUE ORDER BY location_name'),
            execQuery(equipmentPool, `
                SELECT
                    (SELECT COUNT(*) FROM employees)              AS emp,
                    (SELECT COUNT(*) FROM equipment)              AS equip,
                    (SELECT COUNT(*) FROM active_assignments_view) AS asign
            `)
        ]);
        res.json({
            success: true,
            data: { employees, equipment, assignments, departments, locations },
            stats: {
                totalEmployees:   counts[0].emp,
                totalEquipment:   counts[0].equip,
                totalAssignments: counts[0].asign,
                totalDepartments: departments.length,
                totalLocations:   locations.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) { next(error); }
});

console.log('✅ routes/dashboard.js OPTIMIZADO cargado');
module.exports = dashboardRouter;
