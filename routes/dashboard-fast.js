const express = require('express');
const router = express.Router();
const { equipmentPool, executeQuery } = require('../config/database');

// Caché en memoria (5 minutos)
let dashboardCache = {
    data: null,
    timestamp: null
};
const CACHE_TTL = 5 * 60 * 1000;

// ⚡ ENDPOINT ÚNICO - Todos los datos en 1 query optimizada
router.get('/fast-all', async (req, res) => {
    try {
        const now = Date.now();
        
        // Verificar caché
        if (dashboardCache.data && (now - dashboardCache.timestamp < CACHE_TTL)) {
            console.log('✅ Caché hit');
            return res.json({
                success: true,
                ...dashboardCache.data,
                cached: true,
                cacheAge: Math.round((now - dashboardCache.timestamp) / 1000)
            });
        }

        console.log('🔄 Refrescando caché...');

        // QUERY MEGA-OPTIMIZADA - TODO EN UNA LLAMADA
        const [stats] = await executeQuery(equipmentPool, `
            SELECT 
                (SELECT COUNT(*) FROM equipment) as total_equipos,
                (SELECT COUNT(*) FROM equipment WHERE status = 'Asignado') as asignados,
                (SELECT COUNT(*) FROM equipment WHERE status = 'Disponible') as disponibles,
                (SELECT COUNT(*) FROM equipment WHERE equipment_type = 'Laptop' AND status = 'Disponible') as almacen_laptops,
                (SELECT COUNT(*) FROM equipment WHERE equipment_type = 'Desktop' AND status = 'Disponible') as almacen_desktops,
                (SELECT COUNT(*) FROM equipment WHERE equipment_type = 'Monitor' AND status = 'Disponible') as almacen_monitores
        `);

        // Histórico (últimos 6 meses) - OPTIMIZADO
        const historico = await executeQuery(equipmentPool, `
            SELECT 
                DATE_FORMAT(assignment_date, '%Y-%m') as mes,
                DATE_FORMAT(assignment_date, '%b') as mes_nombre,
                COUNT(*) as total
            FROM assignments
            WHERE assignment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(assignment_date, '%Y-%m')
            ORDER BY mes ASC
            LIMIT 6
        `);

        // Equipos por tipo - OPTIMIZADO
        const porTipo = await executeQuery(equipmentPool, `
            SELECT 
                equipment_type as tipo,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'Asignado' THEN 1 ELSE 0 END) as asignados,
                SUM(CASE WHEN status = 'Disponible' THEN 1 ELSE 0 END) as disponibles
            FROM equipment
            GROUP BY equipment_type
            ORDER BY COUNT(*) DESC
        `);

        // Calcular porcentajes
        const totalEquipos = stats.total_equipos;
        const porcentajeAsignados = totalEquipos > 0 ? ((stats.asignados / totalEquipos) * 100).toFixed(1) : 0;
        const porcentajeDisponibles = totalEquipos > 0 ? ((stats.disponibles / totalEquipos) * 100).toFixed(1) : 0;

        const responseData = {
            stats: {
                total: totalEquipos,
                asignados: stats.asignados,
                disponibles: stats.disponibles,
                porcentaje_asignados: porcentajeAsignados,
                porcentaje_disponibles: porcentajeDisponibles
            },
            almacen: {
                laptops: stats.almacen_laptops,
                desktops: stats.almacen_desktops,
                monitores: stats.almacen_monitores
            },
            historico: historico.map(h => ({
                mes: h.mes,
                mes_nombre: h.mes_nombre,
                total: h.total
            })),
            por_tipo: porTipo,
            timestamp: new Date().toISOString()
        };

        // Guardar en caché
        dashboardCache = {
            data: responseData,
            timestamp: now
        };

        res.json({
            success: true,
            ...responseData,
            cached: false
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;