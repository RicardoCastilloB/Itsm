const express = require('express');
const router = express.Router();
const { equipmentPool, executeQuery } = require('../config/database');

// Endpoint ultrarrápido - SOLO estadísticas
router.get('/stats-only', async (req, res) => {
    try {
        // Leer de la caché (instantáneo)
        const cacheQuery = 'SELECT * FROM dashboard_stats_cache WHERE id = 1';
        const cached = await executeQuery(equipmentPool, cacheQuery);
        
        if (cached.length > 0) {
            const stats = cached[0];
            
            // Si la caché tiene menos de 5 minutos, usarla
            const cacheAge = Date.now() - new Date(stats.last_updated).getTime();
            const fiveMinutes = 5 * 60 * 1000;
            
            if (cacheAge < fiveMinutes) {
                return res.json({
                    success: true,
                    stats: {
                        totalEmployees: stats.total_employees,
                        totalEquipment: stats.total_equipment,
                        totalAssignments: stats.total_assignments,
                        totalDepartments: stats.total_departments,
                        totalLocations: stats.total_locations
                    },
                    timestamp: stats.last_updated,
                    cached: true
                });
            }
        }
        
        // Si no hay caché o está vieja, actualizar en background
        executeQuery(equipmentPool, 'CALL refresh_dashboard_stats()').catch(console.error);
        
        // Mientras tanto, devolver datos actuales
        const [employees, equipment, assignments, departments, locations] = await Promise.all([
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM employees WHERE is_active = 1'),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM equipment'),
            executeQuery(equipmentPool, "SELECT COUNT(*) as count FROM assignments WHERE status = 'Activo'"),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM departments WHERE is_active = 1'),
            executeQuery(equipmentPool, 'SELECT COUNT(*) as count FROM locations WHERE is_active = 1')
        ]);
        
        res.json({
            success: true,
            stats: {
                totalEmployees: employees[0].count,
                totalEquipment: equipment[0].count,
                totalAssignments: assignments[0].count,
                totalDepartments: departments[0].count,
                totalLocations: locations[0].count
            },
            timestamp: new Date(),
            cached: false
        });
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;