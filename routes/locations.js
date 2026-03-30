// ============================================================================
// routes/locations.js - RUTAS PARA UBICACIONES
// ============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { equipmentPool, callStoredProcedure, executeQuery } = require('../config/database');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

// GET /api/locations - Listar ubicaciones
router.get('/', async (req, res, next) => {
  try {
    const query = 'SELECT * FROM locations WHERE is_active = TRUE ORDER BY location_name';
    const results = await executeQuery(equipmentPool, query);
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
  } catch (error) {
    next(error);
  }
});
// GET /api/locations/search - Buscar ubicaciones (DEBE IR ANTES DE /:id)
router.get('/search', async (req, res, next) => {
  try {
    const { term } = req.query;
    
    console.log('🔍 Buscando ubicación:', term);
    
    if (!term) {
      return res.status(400).json({
        success: false,
        error: 'Parámetro de búsqueda requerido'
      });
    }

    const queryStr = `
      SELECT * FROM locations
      WHERE is_active = TRUE
        AND (
          location_name COLLATE utf8mb4_unicode_ci LIKE ?
          OR branch_office_id COLLATE utf8mb4_unicode_ci LIKE ?
          OR city COLLATE utf8mb4_unicode_ci LIKE ?
        )
      ORDER BY location_name
      LIMIT 20
    `;

    const searchTerm = `%${term}%`;
    const results = await executeQuery(equipmentPool, queryStr, [searchTerm, searchTerm, searchTerm]);

    console.log('✅ Ubicaciones encontradas:', results.length);

    res.json({
      success: true,
      data: results,
      count: results.length
    });
  } catch (error) {
    console.error('❌ Error en búsqueda de ubicaciones:', error);
    next(error);
  }
});
// ⭐ NUEVO: PUT /api/locations/update - Actualizar ubicación
router.put('/update', async (req, res) => {
    const {
        id,
        branch_office_id,
        location_name,
        city,
        state,
        country,
        address,
        phone
    } = req.body;

    console.log('═══════════════════════════════════════════════');
    console.log('📥 PUT /api/locations/update');
    console.log('Location ID:', id);
    console.log('Location Name:', location_name);
    console.log('═══════════════════════════════════════════════');

    try {
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                message: 'El ID de ubicación es requerido' 
            });
        }

        // Ver estado antes
        const beforeQuery = 'SELECT * FROM locations WHERE id = ?';
        const before = await executeQuery(equipmentPool, beforeQuery, [id]);
        console.log('📊 Estado ANTES:', before[0]);

        // Actualizar ubicación
        const query = `
            UPDATE equipment_management.locations
            SET 
                branch_office_id = ?,
                location_name = ?,
                city = ?,
                state = ?,
                country = ?,
                address = ?,
                phone = ?
            WHERE id = ?
        `;

        const result = await executeQuery(
            equipmentPool, 
            query, 
            [
                branch_office_id,
                location_name,
                city,
                state,
                country || 'Perú',
                address || null,
                phone || null,
                id
            ]
        );

        console.log('✅ UPDATE result:', {
            affectedRows: result.affectedRows,
            changedRows: result.changedRows
        });

        // Ver estado después
        const afterQuery = 'SELECT * FROM locations WHERE id = ?';
        const after = await executeQuery(equipmentPool, afterQuery, [id]);
        console.log('📊 Estado DESPUÉS:', after[0]);
        console.log('═══════════════════════════════════════════════\n');

        if (result.affectedRows > 0) {
            res.json({ 
                success: true, 
                message: 'Ubicación actualizada correctamente.',
                changedRows: result.changedRows
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'No se encontró la ubicación.' 
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// GET /api/locations/:id - Obtener ubicación por ID
router.get('/:id',
  [
    param('id').isInt({ min: 1 }),
    validate
  ],
  async (req, res, next) => {
    try {
      const query = 'SELECT * FROM locations WHERE id = ?';
      const results = await executeQuery(equipmentPool, query, [req.params.id]);
      
      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Ubicación no encontrada'
        });
      }

      res.json({
        success: true,
        data: results[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/locations - Crear ubicación
router.post('/',
  [
    body('branch_office_id').notEmpty().withMessage('ID de sucursal requerido'),
    body('location_name').notEmpty().withMessage('Nombre de ubicación requerido'),
    body('city').notEmpty().withMessage('Ciudad requerida'),
    body('state').notEmpty().withMessage('Departamento requerido'),
    validate
  ],
  async (req, res, next) => {
    try {
      const { branch_office_id, location_name, city, state, country, address, phone } = req.body;

      const query = `
        INSERT INTO locations (branch_office_id, location_name, city, state, country, address, phone)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await executeQuery(equipmentPool, query, [
        branch_office_id,
        location_name,
        city,
        state,
        country || 'Perú',
        address || null,
        phone || null
      ]);

      res.status(201).json({
        success: true,
        message: 'Ubicación creada exitosamente',
        data: { id: result.insertId }
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          error: 'El ID de sucursal ya existe'
        });
      }
      next(error);
    }
  }
);

module.exports = router;