// ============================================================================
// routes/warranty.js - MÓDULO DE GARANTÍAS Y MANTENIMIENTOS
// ============================================================================

const express = require('express');
const router = express.Router();
const { equipmentPool, executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { body, param, query, validationResult } = require('express-validator');

// Middleware de validación
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ============================================================================
// BUSCAR EQUIPO POR EMAIL DEL USUARIO
// ============================================================================

router.get('/search-by-email', 
  authenticateToken,
  [
    query('email').isEmail().withMessage('Email inválido'),
    validate
  ],
  async (req, res, next) => {
    try {
      const { email } = req.query;
      
      console.log('🔍 Buscando equipos para email:', email);

      const query = `
        SELECT 
          e.id as equipment_id,
          e.device_code,
          e.serial_number,
          e.equipment_type,
          e.brand,
          e.model,
          e.processor,
          e.ram_memory,
          e.disk_capacity,
          e.operating_system,
          e.status,
          e.acquisition_type,
          e.domain,
          e.it_level_1,
          e.it_level_2,
          emp.id as employee_id,
          emp.full_name as employee_name,
          emp.email as employee_email,
          emp.cip as employee_cip,
          a.id as assignment_id,
          a.assignment_date,
          d.department_name,
          l.location_name,
          l.city
        FROM employees emp
        INNER JOIN assignments a ON emp.id = a.employee_id
        INNER JOIN equipment e ON a.equipment_id = e.id
        LEFT JOIN departments d ON a.department_id = d.id
        LEFT JOIN locations l ON a.location_id = l.id
        WHERE emp.email = ?
          AND a.status = 'Activo'
        ORDER BY a.assignment_date DESC
      `;

      const results = await executeQuery(equipmentPool, query, [email]);

      if (results.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: 'No se encontraron equipos asignados a este usuario'
        });
      }

      // Enriquecer con historial de mantenimientos
      for (let equipment of results) {
        const maintenanceQuery = `
          SELECT 
            id,
            maintenance_date,
            maintenance_type,
            component_name,
            component_brand,
            component_model,
            serial_number,
            notes,
            cost,
            technician_name,
            warranty_months,
            warranty_end_date,
            status
          FROM equipment_maintenance
          WHERE equipment_id = ?
          ORDER BY maintenance_date DESC
        `;
        
        const maintenanceHistory = await executeQuery(equipmentPool, maintenanceQuery, [equipment.equipment_id]);
        equipment.maintenance_history = maintenanceHistory;
        equipment.total_maintenances = maintenanceHistory.length;
        equipment.last_maintenance = maintenanceHistory[0] || null;
      }

      res.json({
        success: true,
        data: results,
        count: results.length
      });

    } catch (error) {
      console.error('❌ Error:', error);
      next(error);
    }
  }
);

// ============================================================================
// OBTENER HISTORIAL COMPLETO DE MANTENIMIENTOS DE UN EQUIPO
// ============================================================================

router.get('/maintenance-history/:equipment_id',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { equipment_id } = req.params;

      const query = `
        SELECT 
          m.*,
          e.device_code,
          e.equipment_type,
          e.brand,
          e.model,
          emp.full_name as employee_name,
          emp.email as employee_email,
          emp.cip as employee_cip
        FROM equipment_maintenance m
        INNER JOIN equipment e ON m.equipment_id = e.id
        LEFT JOIN employees emp ON m.employee_id = emp.id
        WHERE m.equipment_id = ?
        ORDER BY m.maintenance_date DESC
      `;

      const results = await executeQuery(equipmentPool, query, [equipment_id]);

      res.json({
        success: true,
        data: results,
        count: results.length
      });

    } catch (error) {
      console.error('❌ Error:', error);
      next(error);
    }
  }
);

// ============================================================================
// REGISTRAR NUEVO MANTENIMIENTO
// ============================================================================

router.post('/maintenance',
  authenticateToken,
  [
    body('equipment_id').isInt().withMessage('ID de equipo requerido'),
    body('maintenance_date').isDate().withMessage('Fecha de mantenimiento requerida'),
    body('maintenance_type').isIn([
      'Cambio Cargador', 
      'Cambio Batería', 
      'Cambio RAM', 
      'Cambio Teclado', 
      'Cambio Pantalla',
      'Cambio Disco Duro',
      'Limpieza Interna',
      'Actualización BIOS',
      'Otro'
    ]).withMessage('Tipo de mantenimiento inválido'),
    body('component_name').optional().isString(),
    body('component_brand').optional().isString(),
    body('component_model').optional().isString(),
    body('serial_number').optional().isString(),
    body('notes').optional().isString(),
    body('cost').optional().isDecimal(),
    body('technician_name').optional().isString(),
    body('warranty_months').optional().isInt(),
    validate
  ],
  async (req, res, next) => {
    try {
      const {
        equipment_id,
        employee_id,
        maintenance_date,
        maintenance_type,
        component_name,
        component_brand,
        component_model,
        serial_number,
        notes,
        cost,
        technician_name,
        warranty_months,
        status
      } = req.body;

      console.log('📝 Registrando mantenimiento:', {
        equipment_id,
        maintenance_type,
        maintenance_date
      });

      // Calcular fecha de fin de garantía si se proporciona warranty_months
      let warranty_end_date = null;
      if (warranty_months && warranty_months > 0) {
        const maintenanceDate = new Date(maintenance_date);
        warranty_end_date = new Date(maintenanceDate);
        warranty_end_date.setMonth(warranty_end_date.getMonth() + warranty_months);
        warranty_end_date = warranty_end_date.toISOString().split('T')[0];
      }

      const insertQuery = `
        INSERT INTO equipment_maintenance (
          equipment_id,
          employee_id,
          maintenance_date,
          maintenance_type,
          component_name,
          component_brand,
          component_model,
          serial_number,
          notes,
          cost,
          technician_name,
          warranty_months,
          warranty_end_date,
          status,
          created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await executeQuery(equipmentPool, insertQuery, [
        equipment_id,
        employee_id || null,
        maintenance_date,
        maintenance_type,
        component_name || null,
        component_brand || null,
        component_model || null,
        serial_number || null,
        notes || null,
        cost || null,
        technician_name || null,
        warranty_months || 0,
        warranty_end_date,
        status || 'Completado',
        req.user?.id || null
      ]);

      res.status(201).json({
        success: true,
        message: 'Mantenimiento registrado exitosamente',
        data: {
          id: result.insertId,
          equipment_id,
          maintenance_type,
          maintenance_date,
          warranty_end_date
        }
      });

    } catch (error) {
      console.error('❌ Error:', error);
      next(error);
    }
  }
);

// ============================================================================
// ACTUALIZAR MANTENIMIENTO
// ============================================================================

router.put('/maintenance/:id',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const {
        maintenance_date,
        maintenance_type,
        component_name,
        component_brand,
        component_model,
        serial_number,
        notes,
        cost,
        technician_name,
        warranty_months,
        status
      } = req.body;

      console.log('📝 Actualizando mantenimiento ID:', id);

      // Calcular warranty_end_date si se proporciona warranty_months
      let warranty_end_date = null;
      if (warranty_months && warranty_months > 0 && maintenance_date) {
        const maintenanceDate = new Date(maintenance_date);
        warranty_end_date = new Date(maintenanceDate);
        warranty_end_date.setMonth(warranty_end_date.getMonth() + warranty_months);
        warranty_end_date = warranty_end_date.toISOString().split('T')[0];
      }

      const updateQuery = `
        UPDATE equipment_maintenance
        SET 
          maintenance_date = COALESCE(?, maintenance_date),
          maintenance_type = COALESCE(?, maintenance_type),
          component_name = ?,
          component_brand = ?,
          component_model = ?,
          serial_number = ?,
          notes = ?,
          cost = ?,
          technician_name = ?,
          warranty_months = COALESCE(?, warranty_months),
          warranty_end_date = ?,
          status = COALESCE(?, status)
        WHERE id = ?
      `;

      const result = await executeQuery(equipmentPool, updateQuery, [
        maintenance_date,
        maintenance_type,
        component_name,
        component_brand,
        component_model,
        serial_number,
        notes,
        cost,
        technician_name,
        warranty_months,
        warranty_end_date,
        status,
        id
      ]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Mantenimiento no encontrado'
        });
      }

      res.json({
        success: true,
        message: 'Mantenimiento actualizado exitosamente'
      });

    } catch (error) {
      console.error('❌ Error:', error);
      next(error);
    }
  }
);

// ============================================================================
// ELIMINAR MANTENIMIENTO
// ============================================================================

router.delete('/maintenance/:id',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const deleteQuery = 'DELETE FROM equipment_maintenance WHERE id = ?';
      const result = await executeQuery(equipmentPool, deleteQuery, [id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Mantenimiento no encontrado'
        });
      }

      res.json({
        success: true,
        message: 'Mantenimiento eliminado exitosamente'
      });

    } catch (error) {
      console.error('❌ Error:', error);
      next(error);
    }
  }
);

// ============================================================================
// ESTADÍSTICAS DE MANTENIMIENTOS
// ============================================================================

router.get('/stats',
  authenticateToken,
  async (req, res, next) => {
    try {
      const queries = {
        totalMantenimientos: `
          SELECT COUNT(*) as total
          FROM equipment_maintenance
          WHERE YEAR(maintenance_date) = YEAR(CURDATE())
        `,
        
        porTipo: `
          SELECT 
            maintenance_type,
            COUNT(*) as cantidad,
            ROUND(AVG(cost), 2) as costo_promedio,
            SUM(cost) as costo_total
          FROM equipment_maintenance
          WHERE YEAR(maintenance_date) = YEAR(CURDATE())
          GROUP BY maintenance_type
          ORDER BY cantidad DESC
        `,
        
        proximosVencer: `
          SELECT 
            m.id,
            m.maintenance_type,
            m.component_name,
            m.warranty_end_date,
            TIMESTAMPDIFF(DAY, CURDATE(), m.warranty_end_date) as dias_restantes,
            e.device_code,
            e.brand,
            e.model,
            emp.full_name as employee_name,
            emp.email as employee_email
          FROM equipment_maintenance m
          INNER JOIN equipment e ON m.equipment_id = e.id
          LEFT JOIN assignments a ON e.id = a.equipment_id AND a.status = 'Activo'
          LEFT JOIN employees emp ON a.employee_id = emp.id
          WHERE m.warranty_end_date IS NOT NULL
            AND m.warranty_end_date >= CURDATE()
            AND m.warranty_end_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
          ORDER BY m.warranty_end_date ASC
          LIMIT 20
        `,
        
        costoMensual: `
          SELECT 
            DATE_FORMAT(maintenance_date, '%Y-%m') as mes,
            DATE_FORMAT(maintenance_date, '%b %Y') as mes_nombre,
            COUNT(*) as cantidad,
            ROUND(SUM(cost), 2) as costo_total
          FROM equipment_maintenance
          WHERE maintenance_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
          GROUP BY DATE_FORMAT(maintenance_date, '%Y-%m'), DATE_FORMAT(maintenance_date, '%b %Y')
          ORDER BY mes ASC
        `
      };

      const [totalMantenimientos, porTipo, proximosVencer, costoMensual] = await Promise.all([
        executeQuery(equipmentPool, queries.totalMantenimientos),
        executeQuery(equipmentPool, queries.porTipo),
        executeQuery(equipmentPool, queries.proximosVencer),
        executeQuery(equipmentPool, queries.costoMensual)
      ]);

      res.json({
        success: true,
        data: {
          total_mantenimientos_año: totalMantenimientos[0].total,
          por_tipo: porTipo,
          proximos_vencer: proximosVencer,
          costo_mensual: costoMensual,
          total_costo_año: porTipo.reduce((sum, item) => sum + (parseFloat(item.costo_total) || 0), 0)
        }
      });

    } catch (error) {
      console.error('❌ Error:', error);
      next(error);
    }
  }
);

// ============================================================================
// REPORTE DE COMPONENTES MÁS CAMBIADOS
// ============================================================================

router.get('/top-components',
  authenticateToken,
  async (req, res, next) => {
    try {
      const query = `
        SELECT 
          maintenance_type,
          COUNT(*) as total_cambios,
          COUNT(DISTINCT equipment_id) as equipos_afectados,
          ROUND(AVG(cost), 2) as costo_promedio,
          ROUND(SUM(cost), 2) as costo_total,
          GROUP_CONCAT(DISTINCT component_brand ORDER BY component_brand SEPARATOR ', ') as marcas_usadas
        FROM equipment_maintenance
        WHERE maintenance_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY maintenance_type
        ORDER BY total_cambios DESC
      `;

      const results = await executeQuery(equipmentPool, query);

      res.json({
        success: true,
        data: results
      });

    } catch (error) {
      console.error('❌ Error:', error);
      next(error);
    }
  }
);

module.exports = router;