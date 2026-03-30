/**
 * inject_csv.js
 * Lee el CSV y lo inyecta en MySQL (departments, locations, employees, equipment, assignments)
 *
 * USO:
 *   1. npm install mysql2 csv-parse
 *   2. Ajusta DB_CONFIG con tus credenciales
 *   3. node inject_csv.js ruta/al/archivo.csv
 */

const fs      = require('fs');
const path    = require('path');
const { parse } = require('csv-parse/sync');
const mysql   = require('mysql2/promise');

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const DB_CONFIG = {
  host:     'localhost',
  port:     3306,
  user:     'ricardo',
  password: 'Misbubus6',
  database: 'equipment_management',
};

const CSV_PATH = process.argv[2] || './data.csv';
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta automáticamente el delimitador mirando la primera línea
 */
function detectDelimiter(firstLine) {
  const counts = {
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ',': (firstLine.match(/,/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Convierte undefined o string vacío a null (seguro para mysql2)
 */
const v = (val, fallback = null) =>
  (val === undefined || val === '' || val === null) ? fallback : val;

/**
 * Parsea el CSV y devuelve array de objetos con headers como keys.
 * Filtra filas completamente vacías.
 */
function loadCSV(filePath) {
  let content = fs.readFileSync(path.resolve(filePath), 'utf8');

  // Eliminar BOM UTF-8 (hace que la primera key tenga caracteres invisibles)
  content = content.replace(/^\uFEFF/, '');

  const firstLine = content.split('\n')[0];
  const delimiter = detectDelimiter(firstLine);
  console.log(`\u{1F50D} Delimitador detectado: "${delimiter === '\t' ? '\\t' : delimiter}"`);

  const rows = parse(content, {
    columns:            true,
    skip_empty_lines:   true,
    trim:               true,
    delimiter,
    relax_column_count: true,
  });

  // Diagnostico: mostrar keys exactas del primer row
  if (rows.length > 0) {
    console.log('\u{1F511} Keys detectadas:');
    Object.keys(rows[0]).forEach(k => {
      const hex = Buffer.from(k).toString('hex');
      console.log(`   "${k}"  [hex: ${hex}]`);
    });
    console.log('');
  }

  // Normalizar keys: limpiar caracteres invisibles/BOM de nombres de columna
  const cleanRows = rows.map(row => {
    const clean = {};
    for (const [k, val] of Object.entries(row)) {
      const cleanKey = k.replace(/[\uFEFF\u200B\u00A0\r]/g, '').trim();
      clean[cleanKey] = val;
    }
    return clean;
  });

  // Filtrar filas completamente vacias
  return cleanRows.filter(row =>
    Object.values(row).some(val => val !== '' && val !== null && val !== undefined)
  );
}

/**
 * Upsert genérico: INSERT ... ON DUPLICATE KEY UPDATE
 * @param {object} conn     - conexión mysql2
 * @param {string} table    - nombre de la tabla
 * @param {object} data     - { col: valor, ... }
 * @param {string[]} updateCols - columnas a actualizar si ya existe
 */
async function upsert(conn, table, data, updateCols) {
  const cols        = Object.keys(data);
  const placeholders = cols.map(() => '?').join(', ');
  const values      = Object.values(data);

  const updates = updateCols
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

/**
 * Procesa una fila del CSV e inserta en las 5 tablas en orden.
 * Nombres de columna tomados exactamente del header del CSV.
 */
async function processRow(conn, row) {
  // Saltar filas sin datos criticos
  if (!v(row['CIP']) && !v(row['Equipo'])) {
    throw new Error('Fila sin CIP ni Equipo - probablemente fila vacia o encabezado duplicado');
  }

  // ── 1. DEPARTMENT ──────────────────────────────────────────────────────────
  // Solo insertar departamento si tiene nombre
  const deptName = v(row['department_name']);
  if (deptName) {
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
  } // end if deptName

  // ── 2. LOCATION ────────────────────────────────────────────────────────────
  await upsert(conn, 'locations', {
    branch_office_id: v(row['branch_office_id']),
    location_name:    v(row['branch_office_id']),
    city:             v(row['state']),   // en el CSV city no viene separado
    state:            v(row['state']),
    country:          'Perú',
    is_active:        1,
  }, ['location_name','city','state']);

  // ── 3. EMPLOYEE ────────────────────────────────────────────────────────────
  await upsert(conn, 'employees', {
    cip:              v(row['CIP']),
    national_id:      v(row['national_id']),
    document_type:    v(row['document_type'], 'DNI'),
    full_name:        v(row['full_name']),
    email:            v(row['email']),
    network_account:  v(row['Cta de red']),
    position_name:    v(row['position_name']),
    category:         v(row['category']),
    employee_group:   v(row['employee_group']),
    legal_entity:     v(row['legal_entity'], 'T. PERU'),
    branch_office_id: v(row['branch_office_id']),
    state:            v(row['state']),
    supervisor_name:  v(row['supervisor_name']),
    // department_id se resuelve por subquery usando department_name
    department_id: null,  // se actualiza abajo
    is_active:        1,
  }, ['full_name','email','network_account','position_name',
      'category','employee_group','branch_office_id',
      'state','supervisor_name','department_id']);

  // Actualizar department_id por nombre (evita depender de un ID externo)
  await conn.execute(`
    UPDATE employees e
    JOIN departments d ON d.department_name = ?
    SET e.department_id = d.id
    WHERE e.cip = ?
  `, [v(row['department_name']), v(row['CIP'])]);

  // ── 4. EQUIPMENT ───────────────────────────────────────────────────────────
  // Normalizar obsolescencia: "7 años" → 7
  const obsRaw = v(row['Obsolecencia'], '');
  const obsYears = obsRaw ? parseInt(obsRaw) || null : null;

  // El CSV tiene "Tipo Adquision " con espacio al final — trim ya lo limpia,
  // pero por si acaso buscamos ambas variantes
  const acqType = v(row['Tipo Adquision'] ?? row['Tipo Adquission'] ?? row['Tipo Adquisicion'], 'Propio');

  await upsert(conn, 'equipment', {
    device_code:        v(row['Equipo']),
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
    status:             v(row['Estado'], 'Asignado'),
  }, ['serial_number','processor','operating_system',
      'disk_capacity','ram_memory','domain','it_level_1','it_level_2','status']);

  // ── 5. ASSIGNMENT ──────────────────────────────────────────────────────────
  // Resolver IDs por claves naturales
  const deviceCode = v(row['Equipo']);
  const sinEquipo  = !deviceCode || deviceCode.toLowerCase().includes('sin equipo') || deviceCode === '-';

  const [[empRow]] = await conn.execute(
    `SELECT id FROM employees WHERE cip = ? LIMIT 1`, [v(row['CIP'])]
  );
  if (!empRow) throw new Error(`Empleado no encontrado: CIP=${row['CIP']}`);
  const empId = empRow.id;

  // Si no hay equipo, solo actualizamos empleado/dept y saltamos assignment
  if (sinEquipo) return;

  const [[eqRow]] = await conn.execute(
    `SELECT id FROM equipment WHERE device_code = ? LIMIT 1`, [deviceCode]
  );
  if (!eqRow) throw new Error(`Equipo no encontrado: device_code=${deviceCode}`);
  const eqId = eqRow.id;

  const [[deptRow]] = await conn.execute(
    `SELECT id FROM departments WHERE department_name = ? LIMIT 1`, [v(row['department_name'])]
  );
  const [[locRow]] = await conn.execute(
    `SELECT id FROM locations WHERE branch_office_id = ? LIMIT 1`, [v(row['branch_office_id'])]
  );
  const deptId = deptRow?.id ?? null;
  const locId  = locRow?.id  ?? null;

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
      [empId, eqId, deptId, locId, v(row['period'], '202509'), v(row['Tipo de relacion'], 'Equipo Unico')]
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
  console.log(`📄 ${rows.length} filas válidas encontradas en el CSV`);

  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('✅ Conectado a la base de datos\n');

  // Asegurar UNIQUE keys necesarias para ON DUPLICATE KEY UPDATE
  await conn.execute(`ALTER TABLE departments ADD UNIQUE KEY IF NOT EXISTS uq_dept_name (department_name)`).catch(() => {});
  await conn.execute(`ALTER TABLE locations   ADD UNIQUE KEY IF NOT EXISTS uq_branch    (branch_office_id)`).catch(() => {});
  await conn.execute(`ALTER TABLE employees   ADD UNIQUE KEY IF NOT EXISTS uq_cip       (cip)`).catch(() => {});
  await conn.execute(`ALTER TABLE equipment   ADD UNIQUE KEY IF NOT EXISTS uq_device    (device_code)`).catch(() => {});

  let ok = 0, errors = 0;

  for (const [i, row] of rows.entries()) {
    try {
      await conn.beginTransaction();
      await processRow(conn, row);
      await conn.commit();
      ok++;
      console.log(`  ✔ [${i + 1}/${rows.length}] ${v(row['full_name'])} / ${v(row['Equipo'])}`);
    } catch (err) {
      await conn.rollback();
      errors++;
      console.error(`  ✖ [${i + 1}] ERROR: ${err.message}`);
    }
  }

  await conn.end();
  console.log(`\n🏁 Listo. ✔ ${ok} OK  ✖ ${errors} con error.`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
