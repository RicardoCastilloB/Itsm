/**
 * inject_csv.js — corregido
 * Maneja filas de "Almacen" (sin CIP real) y valores nulos correctamente
 */

const fs      = require('fs');
const path    = require('path');
const { parse } = require('csv-parse/sync');
const mysql   = require('mysql2/promise');

const DB_CONFIG = {
  host:     'localhost',
  port:     3306,
  user:     'ricardo',
  password: 'Misbubus6',
  database: 'equipment_management',
};

const CSV_PATH = process.argv[2] || './data.csv';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function detectDelimiter(firstLine) {
  const counts = {
    ';':  (firstLine.match(/;/g)  || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ',':  (firstLine.match(/,/g)  || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

const v = (val, fallback = null) =>
  (val === undefined || val === '' || val === null) ? fallback : val;

/**
 * Detecta si un valor es "Almacen" o equivalente (no es un CIP real)
 */
function esAlmacen(val) {
  if (!val) return true;
  const s = String(val).trim().toLowerCase();
  return s === 'almacen' || s === 'almacén' || s === '-' || s === 'n/a' || s === 'na';
}

function loadCSV(filePath) {
  let content = fs.readFileSync(path.resolve(filePath), 'utf8');
  content = content.replace(/^\uFEFF/, '');

  const firstLine = content.split('\n')[0];
  const delimiter = detectDelimiter(firstLine);
  console.log(`🔍 Delimitador detectado: "${delimiter === '\t' ? '\\t' : delimiter}"`);

  const rows = parse(content, {
    columns:            true,
    skip_empty_lines:   true,
    trim:               true,
    delimiter,
    relax_column_count: true,
  });

  if (rows.length > 0) {
    console.log('🔑 Keys detectadas:');
    Object.keys(rows[0]).forEach(k => console.log(`   "${k}"`));
    console.log('');
  }

  const cleanRows = rows.map(row => {
    const clean = {};
    for (const [k, val] of Object.entries(row)) {
      const cleanKey = k.replace(/[\uFEFF\u200B\u00A0\r]/g, '').trim();
      clean[cleanKey] = val;
    }
    return clean;
  });

  return cleanRows.filter(row =>
    Object.values(row).some(val => val !== '' && val !== null && val !== undefined)
  );
}

async function upsert(conn, table, data, updateCols) {
  const cols         = Object.keys(data);
  const placeholders = cols.map(() => '?').join(', ');
  const values       = Object.values(data);
  const updates      = updateCols
    .map(col => `\`${col}\` = VALUES(\`${col}\`)`)
    .join(', ');

  const sql = `
    INSERT INTO \`${table}\` (\`${cols.join('`, `')}\`)
    VALUES (${placeholders})
    ON DUPLICATE KEY UPDATE ${updates}
  `;
  const [result] = await conn.execute(sql, values);
  return result;
}

// ─── PROCESAR FILA ────────────────────────────────────────────────────────────

async function processRow(conn, row) {
  const cip        = v(row['CIP']);
  const deviceCode = v(row['Equipo']);
  const cipEsAlmacen = esAlmacen(cip);

  // Fila completamente vacía — saltar
  if (!cip && !deviceCode) {
    throw new Error('Fila sin CIP ni Equipo');
  }

  // ── 1. DEPARTMENT ────────────────────────────────────────────────────────
  const deptName = v(row['department_name']);
  if (deptName && !esAlmacen(deptName)) {
    await upsert(conn, 'departments', {
      department_name: deptName,
      division:        v(row['division']),
      subactivity:     v(row['subactivity']),
      desc_ceo:        v(row['desc_ceo']),
      desc_ceo_1:      v(row['desc_ceo_1']),
      desc_ceo_2:      v(row['desc_ceo_2']),
      desc_ceo_3:      v(row['desc_ceo_3']),
      desc_ceo_4:      v(row['desc_ceo_4']),
      desc_ceo_5:      v(row['desc_ceo_5']),
      desc_ceo_6:      v(row['desc_ceo_6']),
      desc_ceo_7:      v(row['desc_ceo_7']),
      is_active:       1,
    }, ['division','subactivity',
        'desc_ceo','desc_ceo_1','desc_ceo_2','desc_ceo_3',
        'desc_ceo_4','desc_ceo_5','desc_ceo_6','desc_ceo_7']);
  }

  // ── 2. LOCATION ──────────────────────────────────────────────────────────
  const branchId = v(row['branch_office_id']);
  if (branchId && !esAlmacen(branchId)) {
    await upsert(conn, 'locations', {
      branch_office_id: branchId,
      location_name:    branchId,
      city:             v(row['state']),
      state:            v(row['state']),
      country:          'Perú',
      is_active:        1,
    }, ['location_name','city','state']);
  }

  // ── 3. EMPLOYEE ──────────────────────────────────────────────────────────
  // Solo insertar empleado si tiene CIP real (no Almacen)
  if (!cipEsAlmacen && cip) {
    await upsert(conn, 'employees', {
      cip:              cip,
      national_id:      v(row['national_id']),
      document_type:    v(row['document_type'], 'DNI'),
      full_name:        v(row['full_name']),
      email:            v(row['email']),
      network_account:  v(row['Cta de red']),
      position_name:    v(row['position_name']),
      category:         v(row['category']),
      employee_group:   v(row['employee_group']),
      legal_entity:     v(row['legal_entity'], 'T. PERU'),
      branch_office_id: branchId && !esAlmacen(branchId) ? branchId : null,
      state:            v(row['state']),
      supervisor_name:  v(row['supervisor_name']),
      department_id:    null,
      is_active:        1,
    }, ['full_name','email','network_account','position_name',
        'category','employee_group','branch_office_id',
        'state','supervisor_name','department_id']);

    // Actualizar department_id por nombre
    if (deptName && !esAlmacen(deptName)) {
      await conn.execute(`
        UPDATE employees e
        JOIN departments d ON d.department_name = ?
        SET e.department_id = d.id
        WHERE e.cip = ?
      `, [deptName, cip]);
    }
  }

  // ── 4. EQUIPMENT ─────────────────────────────────────────────────────────
  if (!deviceCode || esAlmacen(deviceCode)) return; // sin equipo, nada más que hacer

  const obsRaw   = v(row['Obsolecencia'], '');
  const obsYears = obsRaw ? parseInt(obsRaw) || null : null;
  const acqType  = v(row['Tipo Adquision'] ?? row['Tipo Adquission'] ?? row['Tipo Adquisicion'], 'Propio');

  // Si es Almacen → equipo Disponible, si tiene CIP real → Asignado
  const estadoEquipo = cipEsAlmacen ? 'Disponible' : v(row['Estado'], 'Asignado');

  await upsert(conn, 'equipment', {
    device_code:        deviceCode,
    serial_number:      v(row['Serie']),
    equipment_type:     v(row['Tipo'], 'Laptop'),
    brand:              v(row['Marca']),
    model:              v(row['Modelo']),
    processor:          v(row['Procesador']),
    operating_system:   v(row['SO']),
    disk_capacity:      v(row['DISCO']),
    ram_memory:         v(row['MEMORIA']),
    acquisition_type:   acqType,
    obsolescence_years: obsYears,
    domain:             v(row['Dominio']),
    it_level_1:         v(row['Nivel 1']),
    it_level_2:         v(row['Nivel 2']),
    status:             estadoEquipo,
  }, ['serial_number','equipment_type','brand','model','processor',
      'operating_system','disk_capacity','ram_memory','acquisition_type',
      'obsolescence_years','domain','it_level_1','it_level_2','status']);

  // ── 5. ASSIGNMENT ─────────────────────────────────────────────────────────
  // Si es Almacen → NO crear asignación (equipo queda Disponible sin dueño)
  if (cipEsAlmacen) {
    console.log(`   📦 Almacen: ${deviceCode} insertado como Disponible (sin asignación)`);
    return;
  }

  // Resolver employee_id
  const [[empRow]] = await conn.execute(
    `SELECT id FROM employees WHERE cip = ? LIMIT 1`, [cip]
  );
  if (!empRow) throw new Error(`Empleado no encontrado: CIP=${cip}`);
  const empId = empRow.id;

  // Resolver equipment_id
  const [[eqRow]] = await conn.execute(
    `SELECT id FROM equipment WHERE device_code = ? LIMIT 1`, [deviceCode]
  );
  if (!eqRow) throw new Error(`Equipo no encontrado: device_code=${deviceCode}`);
  const eqId = eqRow.id;

  // Resolver department_id y location_id
  const [[deptRow]] = deptName && !esAlmacen(deptName)
    ? await conn.execute(`SELECT id FROM departments WHERE department_name = ? LIMIT 1`, [deptName])
    : [[null]];

  const [[locRow]] = branchId && !esAlmacen(branchId)
    ? await conn.execute(`SELECT id FROM locations WHERE branch_office_id = ? LIMIT 1`, [branchId])
    : [[null]];

  const deptId = deptRow?.id ?? null;
  const locId  = locRow?.id  ?? null;

  // Verificar si ya existe asignación activa para este par empleado+equipo
  const [existing] = await conn.execute(
    `SELECT id FROM assignments
     WHERE employee_id = ? AND equipment_id = ? AND status = 'Activo' LIMIT 1`,
    [empId, eqId]
  );

  if (existing.length === 0) {
    await conn.execute(
      `INSERT INTO assignments
        (employee_id, equipment_id, department_id, location_id,
         period, assignment_date, relation_type, status)
       VALUES (?, ?, ?, ?, ?, CURDATE(), ?, 'Activo')`,
      [empId, eqId, deptId, locId,
       v(row['period'], '202509'),
       v(row['Tipo de relacion'], 'Equipo Unico')]
    );
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ Archivo no encontrado: ${CSV_PATH}`);
    process.exit(1);
  }

  const rows = loadCSV(CSV_PATH);
  console.log(`📄 ${rows.length} filas válidas encontradas en el CSV\n`);

  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('✅ Conectado a la base de datos\n');

  // Asegurar UNIQUE keys
  await conn.execute(`ALTER TABLE departments ADD UNIQUE KEY IF NOT EXISTS uq_dept_name (department_name)`).catch(() => {});
  await conn.execute(`ALTER TABLE locations   ADD UNIQUE KEY IF NOT EXISTS uq_branch    (branch_office_id)`).catch(() => {});
  await conn.execute(`ALTER TABLE employees   ADD UNIQUE KEY IF NOT EXISTS uq_cip       (cip)`).catch(() => {});
  await conn.execute(`ALTER TABLE equipment   ADD UNIQUE KEY IF NOT EXISTS uq_device    (device_code)`).catch(() => {});

  let ok = 0, errores = 0, almacen = 0;

  for (const [i, row] of rows.entries()) {
    try {
      await conn.beginTransaction();
      await processRow(conn, row);
      await conn.commit();

      if (esAlmacen(v(row['CIP']))) {
        almacen++;
      } else {
        ok++;
      }

      if ((i + 1) % 100 === 0) {
        console.log(`  ⏳ Procesadas ${i + 1}/${rows.length} filas...`);
      }

    } catch (err) {
      await conn.rollback();
      errores++;
      console.error(`  ✖ [${i + 1}] ERROR: ${err.message} | CIP=${v(row['CIP'])} Equipo=${v(row['Equipo'])}`);
    }
  }

  await conn.end();
  console.log(`\n🏁 Listo.`);
  console.log(`   ✔ ${ok} asignaciones creadas`);
  console.log(`   📦 ${almacen} equipos en almacén (Disponible, sin asignación)`);
  console.log(`   ✖ ${errores} con error`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});