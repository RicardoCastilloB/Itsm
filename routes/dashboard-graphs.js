const express = require('express');
const router = express.Router();
const { equipmentPool, executeQuery } = require('../config/database');

// Caché en memoria (se actualiza cada 5 minutos)
let dashboardCache = {
    data: null,
    timestamp: null
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Endpoint ultrarrápido - TODOS los datos en 1 query
router.get('/graphs-all', async (req, res) => {
    try {
        // Verificar caché
        const now = Date.now();
        if (dashboardCache.data && dashboardCache.timestamp && (now - dashboardCache.timestamp < CACHE_DURATION)) {
            console.log('✅ Sirviendo desde caché');
            return res.json({
                success: true,
                data: dashboardCache.data,
                cached: true,
                timestamp: dashboardCache.timestamp
            });
        }

        console.log('🔄 Actualizando caché...');

        // QUERY OPTIMIZADA - TODO EN UNA SOLA CONSULTA
        const query = `
            SELECT 
                -- Equipos por tipo en almacén
                (SELECT COUNT(*) FROM equipment WHERE equipment_type = 'Laptop' AND status = 'Disponible') as almacen_laptops,
                (SELECT COUNT(*) FROM equipment WHERE equipment_type = 'Desktop' AND status = 'Disponible') as almacen_desktops,
                (SELECT COUNT(*) FROM equipment WHERE equipment_type = 'Monitor' AND status = 'Disponible') as almacen_monitores,
                
                -- Histórico de asignaciones (últimos 12 meses)
                (SELECT JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'mes', DATE_FORMAT(assignment_date, '%Y-%m'),
                        'mes_nombre', DATE_FORMAT(assignment_date, '%b %Y'),
                        'total', COUNT(*)
                    )
                ) FROM (
                    SELECT assignment_date 
                    FROM assignments 
                    WHERE assignment_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                    GROUP BY DATE_FORMAT(assignment_date, '%Y-%m')
                    ORDER BY assignment_date DESC
                    LIMIT 12
                ) as monthly_data) as historico_asignaciones,
                
                -- Stats generales
                (SELECT COUNT(*) FROM equipment WHERE status = 'Asignado') as total_asignados,
                (SELECT COUNT(*) FROM equipment WHERE status = 'Disponible') as total_disponibles,
                (SELECT COUNT(*) FROM equipment) as total_equipos
        `;

        const [result] = await executeQuery(equipmentPool, query);

        // Procesar histórico
        let historico = [];
        if (result.historico_asignaciones) {
            try {
                historico = JSON.parse(result.historico_asignaciones);
            } catch (e) {
                historico = [];
            }
        }

        const responseData = {
            almacen: {
                laptops: result.almacen_laptops || 0,
                desktops: result.almacen_desktops || 0,
                monitores: result.almacen_monitores || 0
            },
            historico: historico,
            stats: {
                total_equipos: result.total_equipos || 0,
                total_asignados: result.total_asignados || 0,
                total_disponibles: result.total_disponibles || 0,
                promedio_mensual: historico.length > 0 
                    ? Math.round(historico.reduce((sum, m) => sum + m.total, 0) / historico.length)
                    : 0
            }
        };

        // Actualizar caché
        dashboardCache.data = responseData;
        dashboardCache.timestamp = now;

        res.json({
            success: true,
            data: responseData,
            cached: false,
            timestamp: now
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;