/**
 * inject.js
 * Lee un CSV (separado por TABs) con asignaciones de equipos a empleados
 * e inserta/actualiza los registros en las tablas:
 *   departments, locations, employees, equipment, assignments
 *
 * USO:
 *   node inject.js ruta/al/archivo.csv
 *
 * DEPENDENCIAS:
 *   npm install mysql2 csv-parse
 *
 * CONFIGURACIÓN: ajusta DB_CONFIG con tus credenciales.
 */

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const mysql = require("mysql2/promise");

// ─── CONFIGURACIÓN DE BD ────────────────────────────────────────────────────
const DB_CONFIG = {
  host: "localhost",
  port: 3306,
  user: "ricardo",
  password: "Misbubus6",
  database: "equipment_management",
  waitForConnections: true,
  connectionLimit: 5,
};

// ─── MAPEO DE COLUMNAS CSV ───────────────────────────────────────────────────
// Índice → nombre de columna (base 0)
const COL = {
  period: 0,
  cip: 1,
  national_id: 2,
  document_type: 3,
  full_name: 4,
  email: 5,
  network_account: 6,
  status: 7,           // "Asignado" → assignment.status
  relation_type: 8,
  device_code: 9,      // equipment.device_code
  model: 10,
  serial_number: 11,
  processor: 12,
  operating_system: 13,
  disk_capacity: 14,
  ram_memory: 15,
  equipment_type: 16,
  brand: 17,
  acquisition_type: 18,
  obsolescence_years: 19,
  domain: 20,
  it_level_1: 21,
  it_level_2: 22,
  position_name: 23,
  category: 24,
  employee_group: 25,
  legal_entity: 26,
  department_name: 27,
  division: 28,
  subactivity: 29,
  supervisor_name: 30,
  branch_office_id: 31,
  state: 32,
  desc_ceo: 33,
  desc_ceo_1: 34,
  desc_ceo_2: 35,
  desc_ceo_3: 36,
  desc_ceo_4: 37,
  desc_ceo_5: 38,
  desc_ceo_6: 39,
  desc_ceo_7: 40,
  // desc_ceo_8..10 se ignoran (no existen en el schema)
};

// ─── HELPERS ────────────────────────────────────────────────────────────────
const v = (row, key) => {
  const val = row[COL[key]];
  return val !== undefined && val.trim() !== "" ? val.trim() : null;
};

const toInt = (str) => {
  if (!str) return null;
  const n = parseInt(str.replace(/\D/g, ""), 10);
  return isNaN(n) ? null : n;
};

// Normaliza "Asignado" / "Desasignado" → enum válido
const mapStatus = (val) => {
  if (!val) return "Activo";
  const lower = val.toLowerCase();
  if (lower.includes("asignado")) return "Activo";
  if (lower.includes("desasignado")) return "Inactivo";
  return "Activo";
};

// Normaliza acquisition_type → enum('Propio','Arrendado','Prestado',...)
const mapAcquisition = (val) => {
  if (!val) return null;
  const lower = val.toLowerCase();
  if (lower.includes("propio")) return "Propio";
  if (lower.includes("arrend")) return "Arrendado";
  if (lower.includes("presta")) return "Prestado";
  return val; // devuelve tal cual si no matchea
};

// Normaliza equipment_type → enum('Laptop','Desktop','Monitor',...)
const mapEquipmentType = (val) => {
  if (!val) return null;
  const lower = val.toLowerCase();
  if (lower.includes("laptop")) return "Laptop";
  if (lower.includes("desktop") || lower.includes("pc")) return "Desktop";
  if (lower.includes("monitor")) return "Monitor";
  if (lower.includes("tablet")) return "Tablet";
  if (lower.includes("celular") || lower.includes("móvil") || lower.includes("movil")) return "Celular";
  return val;
};

// ─── LÓGICA DE UPSERT ────────────────────────────────────────────────────────

async function upsertDepartment(conn, row) {
  const dept_name = v(row, "department_name");
  if (!dept_name) return null;

  const [rows] = await conn.execute(
    "SELECT id FROM departments WHERE department_name = ? LIMIT 1",
    [dept_name]
  );
  if (rows.length > 0) return rows[0].id;

  const [result] = await conn.execute(
    `INSERT INTO departments
       (department_name, division, subactivity, is_active,
        desc_ceo, desc_ceo_1, desc_ceo_2, desc_ceo_3,
        desc_ceo_4, desc_ceo_5, desc_ceo_6, desc_ceo_7)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dept_name,
      v(row, "division"),
      v(row, "subactivity"),
      v(row, "desc_ceo"),
      v(row, "desc_ceo_1"),
      v(row, "desc_ceo_2"),
      v(row, "desc_ceo_3"),
      v(row, "desc_ceo_4"),
      v(row, "desc_ceo_5"),
      v(row, "desc_ceo_6"),
      v(row, "desc_ceo_7"),
    ]
  );
  return result.insertId;
}

async function upsertLocation(conn, row) {
  const branch = v(row, "branch_office_id");
  if (!branch) return null;

  const [rows] = await conn.execute(
    "SELECT id FROM locations WHERE branch_office_id = ? LIMIT 1",
    [branch]
  );
  if (rows.length > 0) return rows[0].id;

  const [result] = await conn.execute(
    `INSERT INTO locations
       (branch_office_id, location_name, city, state, country, is_active)
     VALUES (?, ?, ?, ?, 'Perú', 1)`,
    [branch, branch, v(row, "state"), v(row, "state")]
  );
  return result.insertId;
}

async function upsertEmployee(conn, row, departmentId, locationId) {
  const cip = v(row, "cip");
  if (!cip) return null;

  const [rows] = await conn.execute(
    "SELECT id FROM employees WHERE cip = ? LIMIT 1",
    [cip]
  );

  const fields = {
    cip,
    national_id: v(row, "national_id"),
    document_type: v(row, "document_type") || "DNI",
    full_name: v(row, "full_name"),
    email: v(row, "email"),
    network_account: v(row, "network_account"),
    position_name: v(row, "position_name"),
    category: v(row, "category"),
    employee_group: v(row, "employee_group"),
    legal_entity: v(row, "legal_entity"),
    supervisor_name: v(row, "supervisor_name"),
    branch_office_id: v(row, "branch_office_id"),
    state: v(row, "state"),
    department_id: departmentId,
    is_active: 1,
  };

  if (rows.length > 0) {
    await conn.execute(
      `UPDATE employees SET
         national_id=?, document_type=?, full_name=?, email=?,
         network_account=?, position_name=?, category=?,
         employee_group=?, legal_entity=?, supervisor_name=?,
         branch_office_id=?, state=?, department_id=?, is_active=1
       WHERE cip=?`,
      [
        fields.national_id, fields.document_type, fields.full_name,
        fields.email, fields.network_account, fields.position_name,
        fields.category, fields.employee_group, fields.legal_entity,
        fields.supervisor_name, fields.branch_office_id, fields.state,
        fields.department_id, cip,
      ]
    );
    return rows[0].id;
  }

  const [result] = await conn.execute(
    `INSERT INTO employees
       (cip, national_id, document_type, full_name, email,
        network_account, position_name, category, employee_group,
        legal_entity, supervisor_name, branch_office_id, state,
        department_id, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      fields.cip, fields.national_id, fields.document_type,
      fields.full_name, fields.email, fields.network_account,
      fields.position_name, fields.category, fields.employee_group,
      fields.legal_entity, fields.supervisor_name, fields.branch_office_id,
      fields.state, fields.department_id, 1,
    ]
  );
  return result.insertId;
}

async function upsertEquipment(conn, row) {
  const device_code = v(row, "device_code");
  if (!device_code) return null;

  const [rows] = await conn.execute(
    "SELECT id FROM equipment WHERE device_code = ? LIMIT 1",
    [device_code]
  );

  const obsolescence = toInt(v(row, "obsolescence_years"));

  const fields = [
    device_code,
    v(row, "model"),
    v(row, "serial_number"),
    v(row, "processor"),
    v(row, "operating_system"),
    v(row, "disk_capacity"),
    v(row, "ram_memory"),
    mapEquipmentType(v(row, "equipment_type")),
    v(row, "brand"),
    mapAcquisition(v(row, "acquisition_type")),
    obsolescence,
    v(row, "domain"),
    v(row, "it_level_1"),
    v(row, "it_level_2"),
  ];

  if (rows.length > 0) {
    await conn.execute(
      `UPDATE equipment SET
         model=?, serial_number=?, processor=?, operating_system=?,
         disk_capacity=?, ram_memory=?, equipment_type=?, brand=?,
         acquisition_type=?, obsolescence_years=?, domain=?,
         it_level_1=?, it_level_2=?
       WHERE device_code=?`,
      [...fields.slice(1), device_code]
    );
    return rows[0].id;
  }

  const [result] = await conn.execute(
    `INSERT INTO equipment
       (device_code, model, serial_number, processor, operating_system,
        disk_capacity, ram_memory, equipment_type, brand, acquisition_type,
        obsolescence_years, domain, it_level_1, it_level_2, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Disponible')`,
    fields
  );
  return result.insertId;
}

async function upsertAssignment(conn, row, employeeId, equipmentId, departmentId, locationId) {
  const period = v(row, "period");
  const relation_type = v(row, "relation_type");
  const status = mapStatus(v(row, "status"));

  // Busca asignación activa existente para ese equipo
  const [rows] = await conn.execute(
    `SELECT id FROM assignments
     WHERE equipment_id = ? AND employee_id = ? AND period = ?
     LIMIT 1`,
    [equipmentId, employeeId, period]
  );

  if (rows.length > 0) {
    await conn.execute(
      `UPDATE assignments SET
         status=?, relation_type=?, department_id=?, location_id=?
       WHERE id=?`,
      [status, relation_type, departmentId, locationId, rows[0].id]
    );
    return rows[0].id;
  }

  const [result] = await conn.execute(
    `INSERT INTO assignments
       (employee_id, equipment_id, department_id, location_id,
        period, relation_type, status, assignment_date)
     VALUES (?,?,?,?,?,?,?, CURDATE())`,
    [employeeId, equipmentId, departmentId, locationId,
     period, relation_type, status]
  );
  return result.insertId;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("❌  Uso: node inject.js <ruta_csv>");
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(csvPath), "utf8");

  // Parsea TSV (separado por TABs)
  const records = parse(raw, {
    delimiter: "\t",
    skip_empty_lines: true,
    relax_column_count: true,
    from_line: 2, // salta la cabecera
  });

  console.log(`📄  Filas a procesar: ${records.length}`);

  const pool = mysql.createPool(DB_CONFIG);

  let ok = 0, errors = 0;

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const deptId  = await upsertDepartment(conn, row);
      const locId   = await upsertLocation(conn, row);
      const empId   = await upsertEmployee(conn, row, deptId, locId);
      const eqpId   = await upsertEquipment(conn, row);

      if (empId && eqpId) {
        await upsertAssignment(conn, row, empId, eqpId, deptId, locId);
      }

      await conn.commit();
      ok++;

      if (ok % 100 === 0) console.log(`  ✅  ${ok} filas insertadas...`);
    } catch (err) {
      await conn.rollback();
      errors++;
      console.error(`  ⚠️  Fila ${i + 2}: ${err.message} | CIP: ${row[COL.cip]} | Equipo: ${row[COL.device_code]}`);
    } finally {
      conn.release();
    }
  }

  await pool.end();
  console.log(`\n🎉  Proceso finalizado — OK: ${ok} | Errores: ${errors}`);
}

main().catch((err) => {
  console.error("❌  Error fatal:", err);
  process.exit(1);
});
