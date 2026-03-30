// ============================================================================
// routes/equipment.js — LIMPIO
// CAMBIO CRÍTICO: eliminada ruta duplicada router.get('/api/equipment', ...)
// que usaba PostgreSQL ($1, $2) e interceptaba/rompía los filtros
// ============================================================================

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { equipmentPool, executeQuery } = require('../config/database');
const checkPermission = require('../middleware/checkPermission');
const { authenticateToken } = require('../middleware/auth');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// ============================================================================
// SECCIÓN 1: RUTAS GET ESPECÍFICAS (sin parámetros dinámicos)
// ============================================================================

router.get('/desktop', async (req, res, next) => {
  try {
    const query = 'SELECT COUNT(*) AS total_equipos FROM equipment WHERE equipment_type = "Desktop"';
    const results = await executeQuery(equipmentPool, query);
    res.json(results[0].total_equipos);
  } catch (error) { next(error); }
});

router.get('/laptop', async (req, res, next) => {
  try {
    const query = 'SELECT COUNT(*) AS total_equipos FROM equipment WHERE equipment_type = "laptop"';
    const results = await executeQuery(equipmentPool, query);
    res.json(results[0].total_equipos);
  } catch (error) { next(error); }
});

router.get('/ultra', async (req, res, next) => {
  try {
    const query = "SELECT COUNT(*) AS total_ultra FROM equipment WHERE processor LIKE '%ultra%'";
    const results = await executeQuery(equipmentPool, query);
    res.json(results[0].total_ultra);
  } catch (error) { next(error); }
});

router.get('/available', async (req, res, next) => {
  try {
    const results = await executeQuery(equipmentPool, 'SELECT * FROM equipment_availability');
    res.json({ success: true, data: results, count: results.length });
  } catch (error) { next(error); }
});

router.get('/search', async (req, res, next) => {
  try {
    const { term } = req.query;
    if (!term) return res.status(400).json({ success: false, error: 'Parámetro de búsqueda requerido' });

// DESPUÉS — solo equipos Disponibles
const queryStr = `
  SELECT id, device_code, serial_number, equipment_type, brand, model,
         processor, operating_system, disk_capacity, ram_memory, status
  FROM equipment
  WHERE status = 'Disponible'
    AND (device_code LIKE ? OR serial_number LIKE ? OR model LIKE ? OR brand LIKE ?)
  ORDER BY device_code LIMIT 20
`;
const searchTerm = `%${term}%`;
const results = await executeQuery(equipmentPool, queryStr, [searchTerm, searchTerm, searchTerm, searchTerm]);
    res.json({ success: true, data: results, count: results.length });
  } catch (error) { next(error); }
});

router.get('/status-options', async (req, res) => {
  try {
    const query = `
      SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'equipment_management'
        AND TABLE_NAME = 'equipment' AND COLUMN_NAME = 'status'
    `;
    const result = await executeQuery(equipmentPool, query);
    if (result.length > 0 && result[0].COLUMN_TYPE?.startsWith('enum')) {
      const match = result[0].COLUMN_TYPE.match(/enum\((.*)\)/i);
      if (match) {
        const values = match[1].split(',').map(v => v.replace(/'/g, '').trim());
        return res.json({ success: true, options: values });
      }
    }
    res.json({ success: true, options: ['Asignado', 'Disponible', 'Mantenimiento', 'Obsoleto'] });
  } catch (error) {
    res.json({ success: true, options: ['Asignado', 'Disponible', 'Mantenimiento', 'Obsoleto'] });
  }
});

// ============================================================================
// SECCIÓN 2: RUTAS CON PARÁMETROS ESPECÍFICOS
// ============================================================================

router.get('/status/:status', async (req, res, next) => {
  try {
    const results = await callStoredProcedure(equipmentPool, 'sp_get_equipment_by_status', [req.params.status]);
    res.json({ success: true, data: results[0], count: results[0].length });
  } catch (error) { next(error); }
});

// ============================================================================
// SECCIÓN 3: PUT /update
// ============================================================================

router.put('/update', async (req, res) => {
  const {
    device_code, serial_number = null, equipment_type = null,
    brand = null, model = null, ram_memory = null, disk_capacity = null, status = null
  } = req.body;

  try {
    if (!device_code) return res.status(400).json({ success: false, message: 'El código de dispositivo es requerido' });

    const query = `
      UPDATE equipment SET
        serial_number = ?, equipment_type = ?, brand = ?, model = ?,
        ram_memory = ?, disk_capacity = ?, status = ?
      WHERE device_code = ?
    `;
    const result = await executeQuery(equipmentPool, query,
      [serial_number, equipment_type, brand, model, ram_memory, disk_capacity, status, device_code]
    );

    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Equipo actualizado correctamente.', changedRows: result.changedRows });
    } else {
      res.status(404).json({ success: false, message: 'No se encontró el equipo.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// SECCIÓN 4: POST / — crear equipo
// ============================================================================

router.post('/',
  authenticateToken,
  checkPermission('equipment', 'create'),
  [
    body('device_code').notEmpty().withMessage('Código de dispositivo requerido'),
    body('serial_number').notEmpty().withMessage('Número de serie requerido'),
    body('equipment_type').isIn(['Laptop', 'Desktop', 'Tablet', 'Smartphone', 'Monitor', 'Otro']).withMessage('Tipo inválido'),
    body('brand').notEmpty().withMessage('Marca requerida'),
    body('model').notEmpty().withMessage('Modelo requerido'),
    validate
  ],
  async (req, res) => {
    let { device_code, serial_number, equipment_type, brand, model,
          processor, operating_system, disk_capacity, ram_memory,
          acquisition_type, obsolescence_years, domain, it_level_1, it_level_2, status } = req.body;

    try {
      // Verificar duplicado device_code
      const checkCode = await executeQuery(equipmentPool,
        'SELECT id FROM equipment WHERE device_code = ? LIMIT 1', [device_code]);
      if (checkCode.length > 0) {
        return res.status(409).json({ success: false, error: `El código "${device_code}" ya existe`, field: 'device_code' });
      }

      // Verificar duplicado serial_number
      const checkSerial = await executeQuery(equipmentPool,
        'SELECT id FROM equipment WHERE serial_number = ? LIMIT 1', [serial_number]);
      if (checkSerial.length > 0) {
        return res.status(409).json({ success: false, error: `El serial "${serial_number}" ya existe`, field: 'serial_number' });
      }

      const result = await executeQuery(equipmentPool, `
        INSERT INTO equipment (
          device_code, serial_number, equipment_type, brand, model,
          processor, operating_system, disk_capacity, ram_memory,
          acquisition_type, obsolescence_years, domain, it_level_1, it_level_2, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        device_code, serial_number, equipment_type, brand, model,
        processor || null, operating_system || null, disk_capacity || null, ram_memory || null,
        acquisition_type || 'Propio', obsolescence_years || null, domain || null,
        it_level_1 || null, it_level_2 || null, status || 'Disponible'
      ]);

      return res.status(201).json({
        success: true, message: 'Equipo creado exitosamente',
        data: { id: result.insertId, device_code, serial_number, brand, model, equipment_type, status: status || 'Disponible' }
      });

    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, error: 'Duplicado detectado', code: 'DUPLICATE_ENTRY' });
      }
      return res.status(500).json({ success: false, error: 'Error al crear el equipo', message: error.message });
    }
  }
);

// ============================================================================
// SECCIÓN 5: GET / — LISTADO CON FILTROS (MYSQL) ← LA RUTA PRINCIPAL
// ⭐ Esta es la única ruta que maneja filtros. La ruta duplicada de PostgreSQL
//    fue eliminada porque usaba $1/$2 y pool.query() (PostgreSQL) en vez de
//    executeQuery(equipmentPool, ...) (MySQL) y rompía el filtrado.
// ============================================================================

router.get('/', authenticateToken, checkPermission('equipment', 'read'), async (req, res, next) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const searchTerm       = (req.query.search           || '').trim();
    const brand            = (req.query.brand            || '').trim() || null;
    const operating_system = (req.query.operating_system || '').trim() || null;

    console.log('📊 GET /api/equipment', { page, limit, search: searchTerm || null, brand, operating_system });

    let whereConditions = [];
    let queryParams     = [];

    if (brand) {
      // NULL se almacena como NULL, "Sin marca" como string vacío o NULL
      if (brand === 'Sin marca') {
        whereConditions.push('(brand IS NULL OR brand = "" OR brand = "Sin marca")');
      } else {
        whereConditions.push('brand = ?');
        queryParams.push(brand);
      }
      console.log('🔵 Filtro MARCA:', brand);
    }

    if (operating_system) {
      whereConditions.push('operating_system = ?');
      queryParams.push(operating_system);
      console.log('🔵 Filtro SO:', operating_system);
    }

    if (searchTerm) {
      const p = `%${searchTerm}%`;
      whereConditions.push(`(
        device_code LIKE ? OR serial_number LIKE ? OR equipment_type LIKE ?
        OR brand LIKE ? OR model LIKE ? OR status LIKE ? OR processor LIKE ? OR ram_memory LIKE ?
      )`);
      for (let i = 0; i < 8; i++) queryParams.push(p);
      console.log('🔍 Búsqueda global:', searchTerm);
    }

    const whereClause = whereConditions.length > 0
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    // Contar total filtrado
    const countResults = await executeQuery(equipmentPool,
      `SELECT COUNT(*) as total FROM equipment ${whereClause}`, queryParams);
    const total = countResults[0].total;

    console.log(`✅ Total filtrado: ${total}`);

    // Datos paginados
    const dataResults = await executeQuery(equipmentPool,
      `SELECT * FROM equipment ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    res.json({
      success: true,
      data: dataResults,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit
      },
      filters: { search: searchTerm || null, brand, operating_system }
    });

  } catch (error) {
    console.error('❌ Error GET /api/equipment:', error);
    next(error);
  }
});

// ============================================================================
// SECCIÓN 6: GET /:id — DEBE IR AL FINAL
// ============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const results = await executeQuery(equipmentPool,
      'SELECT * FROM equipment WHERE device_code = ?', [req.params.id]);
    if (!results.length) return res.status(404).json({ success: false, error: 'Equipo no encontrado' });
    res.json({ success: true, data: results[0] });
  } catch (error) { next(error); }
});

module.exports = router;  
