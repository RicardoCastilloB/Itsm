/**
 * inject.js  v3 — FINAL
 * 
 * FIXES aplicados:
 *  - locations, employees, equipment NO tienen AUTO_INCREMENT → IDs manuales
 *  - equipment.acquisition_type enum: 'Propio','Arrendado','Leasing','Donado'
 *  - equipment.equipment_type enum: 'Laptop','Desktop','Tablet','Smartphone','Monitor','Otro'
 *  - assignments.status enum: 'Activo','Finalizado','Cancelado'
 *  - employees.employee_group enum: 'EMP','EJC','OTROS'
 *
 * USO:   node inject.js ruta/al/archivo.csv
 * DEPS:  npm install mysql2 csv-parse
 */

const fs        = require("fs");
const path      = require("path");
const { parse } = require("csv-parse/sync");
const mysql     = require("mysql2/promise");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DB_CONFIG = {
  host:     "localhost",
  port:     3306,
  user:     "ricardo",
  password: "Misbubus6",
  database: "equipment_management",
};

// ─── ÍNDICES DE COLUMNAS CSV (base 0) ─────────────────────────────────────────
const C = {
  period:0, cip:1, national_id:2, document_type:3, full_name:4,
  email:5, network_account:6, status:7, relation_type:8,
  device_code:9, model:10, serial_number:11, processor:12,
  operating_system:13, disk_capacity:14, ram_memory:15,
  equipment_type:16, brand:17, acquisition_type:18,
  obsolescence_years:19, domain:20, it_level_1:21, it_level_2:22,
  position_name:23, category:24, employee_group:25, legal_entity:26,
  department_name:27, division:28, subactivity:29, supervisor_name:30,
  branch_office_id:31, state:32,
  desc_ceo:33, desc_ceo_1:34, desc_ceo_2:35, desc_ceo_3:36,
  desc_ceo_4:37, desc_ceo_5:38, desc_ceo_6:39, desc_ceo_7:40,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const v = (row, k) => {
  const x = row[C[k]];
  return (x !== undefined && String(x).trim() !== "") ? String(x).trim() : null;
};

const toInt = s => {
  if (!s) return null;
  const n = parseInt(String(s).replace(/\D/g, ""), 10);
  return isNaN(n) ? null : n;
};

// enum('Propio','Arrendado','Leasing','Donado')
const mapAcq = s => {
  if (!s) return "Propio";
  const l = s.toLowerCase();
  if (l.includes("propio"))   return "Propio";
  if (l.includes("arrend"))   return "Arrendado";
  if (l.includes("leasing"))  return "Leasing";
  if (l.includes("donado"))   return "Donado";
  return "Propio";
};

// enum('Laptop','Desktop','Tablet','Smartphone','Monitor','Otro')
const mapEqType = s => {
  if (!s) return "Otro";
  const l = s.toLowerCase();
  if (l.includes("laptop"))                               return "Laptop";
  if (l.includes("desktop") || l.includes("pc"))         return "Desktop";
  if (l.includes("tablet"))                               return "Tablet";
  if (l.includes("smartphone") || l.includes("celular")) return "Smartphone";
  if (l.includes("monitor"))                              return "Monitor";
  return "Otro";
};

// enum('EMP','EJC','OTROS')
const mapEmpGroup = s => {
  if (!s) return null;
  const u = s.toUpperCase().trim();
  if (u === "EMP") return "EMP";
  if (u === "EJC") return "EJC";
  return "OTROS";
};

// enum('Activo','Finalizado','Cancelado')
const mapAssignStatus = s => {
  if (!s) return "Activo";
  const l = s.toLowerCase();
  if (l.includes("finaliz"))  return "Finalizado";
  if (l.includes("cancel"))   return "Cancelado";
  return "Activo";
};

// ─── CONTADORES DE ID (para tablas sin AUTO_INCREMENT) ────────────────────────
let nextLocId = 1;
let nextEmpId = 1;
let nextEqpId = 1;

async function initCounters(conn) {
  const [[{maxLoc}]] = await conn.execute("SELECT COALESCE(MAX(id),0) AS maxLoc FROM locations");
  const [[{maxEmp}]] = await conn.execute("SELECT COALESCE(MAX(id),0) AS maxEmp FROM employees");
  const [[{maxEqp}]] = await conn.execute("SELECT COALESCE(MAX(id),0) AS maxEqp FROM equipment");
  nextLocId = maxLoc + 1;
  nextEmpId = maxEmp + 1;
  nextEqpId = maxEqp + 1;
  console.log(`🔢  Contadores iniciales — loc:${nextLocId} emp:${nextEmpId} eqp:${nextEqpId}`);
}

// ─── CACHES (evita SELECTs repetidos) ─────────────────────────────────────────
const cacheDept = new Map(); // department_name → id
const cacheLoc  = new Map(); // branch_office_id → id
const cacheEmp  = new Map(); // cip → id
const cacheEqp  = new Map(); // device_code → id

// ─── UPSERTS ──────────────────────────────────────────────────────────────────

async function getDept(conn, row) {
  const name = v(row, "department_name");
  if (!name) return null;
  if (cacheDept.has(name)) return cacheDept.get(name);

  const [rows] = await conn.execute(
    "SELECT id FROM departments WHERE department_name=? LIMIT 1", [name]
  );
  if (rows.length) {
    cacheDept.set(name, rows[0].id);
    return rows[0].id;
  }

  // departments SÍ tiene AUTO_INCREMENT
  const [r] = await conn.execute(
    `INSERT INTO departments
       (department_name, division, subactivity, is_active,
        desc_ceo, desc_ceo_1, desc_ceo_2, desc_ceo_3,
        desc_ceo_4, desc_ceo_5, desc_ceo_6, desc_ceo_7)
     VALUES (?,?,?,1,?,?,?,?,?,?,?,?)`,
    [
      name,
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
  cacheDept.set(name, r.insertId);
  return r.insertId;
}

async function getLoc(conn, row) {
  const branch = v(row, "branch_office_id");
  if (!branch) return null;
  if (cacheLoc.has(branch)) return cacheLoc.get(branch);

  const [rows] = await conn.execute(
    "SELECT id FROM locations WHERE branch_office_id=? LIMIT 1", [branch]
  );
  if (rows.length) {
    cacheLoc.set(branch, rows[0].id);
    return rows[0].id;
  }

  // locations NO tiene AUTO_INCREMENT → ID manual
  const newId = nextLocId++;
  await conn.execute(
    `INSERT INTO locations (id, branch_office_id, location_name, city, state, country, is_active)
     VALUES (?,?,?,?,?,'Perú',1)`,
    [newId, branch, branch, v(row, "state") || branch, v(row, "state") || branch]
  );
  cacheLoc.set(branch, newId);
  return newId;
}

async function getEmp(conn, row, deptId) {
  const cip = v(row, "cip");
  if (!cip) return null;
  if (cacheEmp.has(cip)) return cacheEmp.get(cip);

  const [rows] = await conn.execute(
    "SELECT id FROM employees WHERE cip=? LIMIT 1", [cip]
  );
  if (rows.length) {
    // Actualiza
    await conn.execute(
      `UPDATE employees SET
         national_id=?, document_type=?, full_name=?, email=?,
         network_account=?, position_name=?, category=?, employee_group=?,
         legal_entity=?, supervisor_name=?, branch_office_id=?, state=?,
         department_id=?, is_active=1
       WHERE cip=?`,
      [
        v(row, "national_id"),
        "DNI",
        v(row, "full_name"),
        v(row, "email"),
        v(row, "network_account"),
        v(row, "position_name"),
        v(row, "category"),
        mapEmpGroup(v(row, "employee_group")),
        v(row, "legal_entity") || "T. PERU",
        v(row, "supervisor_name"),
        v(row, "branch_office_id"),
        v(row, "state"),
        deptId,
        cip,
      ]
    );
    cacheEmp.set(cip, rows[0].id);
    return rows[0].id;
  }

  // employees NO tiene AUTO_INCREMENT → ID manual
  const newId = nextEmpId++;
  await conn.execute(
    `INSERT INTO employees
       (id, cip, national_id, document_type, full_name, email,
        network_account, position_name, category, employee_group,
        legal_entity, supervisor_name, branch_office_id, state,
        department_id, is_active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    [
      newId,
      cip,
      v(row, "national_id"),
      "DNI",
      v(row, "full_name"),
      v(row, "email"),
      v(row, "network_account"),
      v(row, "position_name"),
      v(row, "category"),
      mapEmpGroup(v(row, "employee_group")),
      v(row, "legal_entity") || "T. PERU",
      v(row, "supervisor_name"),
      v(row, "branch_office_id"),
      v(row, "state"),
      deptId,
    ]
  );
  cacheEmp.set(cip, newId);
  return newId;
}

async function getEqp(conn, row) {
  const code = v(row, "device_code");
  if (!code) return null;
  if (cacheEqp.has(code)) return cacheEqp.get(code);

  const [rows] = await conn.execute(
    "SELECT id FROM equipment WHERE device_code=? LIMIT 1", [code]
  );
  if (rows.length) {
    await conn.execute(
      `UPDATE equipment SET
         model=?, serial_number=?, processor=?, operating_system=?,
         disk_capacity=?, ram_memory=?, equipment_type=?, brand=?,
         acquisition_type=?, obsolescence_years=?, domain=?,
         it_level_1=?, it_level_2=?
       WHERE device_code=?`,
      [
        v(row, "model"),
        v(row, "serial_number"),
        v(row, "processor"),
        v(row, "operating_system"),
        v(row, "disk_capacity"),
        v(row, "ram_memory"),
        mapEqType(v(row, "equipment_type")),
        v(row, "brand"),
        mapAcq(v(row, "acquisition_type")),
        toInt(v(row, "obsolescence_years")),
        v(row, "domain"),
        v(row, "it_level_1"),
        v(row, "it_level_2"),
        code,
      ]
    );
    cacheEqp.set(code, rows[0].id);
    return rows[0].id;
  }

  // equipment NO tiene AUTO_INCREMENT → ID manual
  const newId = nextEqpId++;
  await conn.execute(
    `INSERT INTO equipment
       (id, device_code, model, serial_number, processor, operating_system,
        disk_capacity, ram_memory, equipment_type, brand, acquisition_type,
        obsolescence_years, domain, it_level_1, it_level_2, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Disponible')`,
    [
      newId,
      code,
      v(row, "model"),
      v(row, "serial_number"),
      v(row, "processor"),
      v(row, "operating_system"),
      v(row, "disk_capacity"),
      v(row, "ram_memory"),
      mapEqType(v(row, "equipment_type")),
      v(row, "brand"),
      mapAcq(v(row, "acquisition_type")),
      toInt(v(row, "obsolescence_years")),
      v(row, "domain"),
      v(row, "it_level_1"),
      v(row, "it_level_2"),
    ]
  );
  cacheEqp.set(code, newId);
  return newId;
}

async function doAssignment(conn, row, empId, eqpId, deptId, locId) {
  if (!empId || !eqpId) return;
  const period = v(row, "period");

  const [rows] = await conn.execute(
    "SELECT id FROM assignments WHERE equipment_id=? AND employee_id=? AND period=? LIMIT 1",
    [eqpId, empId, period]
  );
  if (rows.length) {
    await conn.execute(
      `UPDATE assignments SET status=?, relation_type=?, department_id=?, location_id=?
       WHERE id=?`,
      [mapAssignStatus(v(row, "status")), v(row, "relation_type"), deptId, locId, rows[0].id]
    );
    return;
  }

  await conn.execute(
    `INSERT INTO assignments
       (employee_id, equipment_id, department_id, location_id,
        period, relation_type, status, assignment_date)
     VALUES (?,?,?,?,?,?,?,CURDATE())`,
    [
      empId, eqpId, deptId, locId,
      period,
      v(row, "relation_type") || "Equipo Unico",
      mapAssignStatus(v(row, "status")),
    ]
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("❌  Uso: node inject.js <archivo.csv>");
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(csvPath), "utf8");
  const records = parse(raw, {
    delimiter: "\t",
    skip_empty_lines: true,
    relax_column_count: true,
    from_line: 2,
  });

  console.log(`📄  Filas a procesar: ${records.length}`);

  const conn = await mysql.createConnection(DB_CONFIG);
  console.log(`✅  Conectado a: ${DB_CONFIG.database}\n`);

  await initCounters(conn);

  let ok = 0, errors = 0;

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    try {
      const deptId = await getDept(conn, row);
      const locId  = await getLoc(conn, row);
      const empId  = await getEmp(conn, row, deptId);
      const eqpId  = await getEqp(conn, row);
      await doAssignment(conn, row, empId, eqpId, deptId, locId);
      ok++;

      if (ok % 200 === 0) {
        const [[{e}]] = await conn.execute("SELECT COUNT(*) AS e FROM employees");
        console.log(`  ✅  ${ok} procesadas | employees en BD: ${e}`);
      }
    } catch (err) {
      errors++;
      console.error(`  ⚠️  Fila ${i + 2}: ${err.message}`);
      console.error(`       CIP=${row[C.cip]} | Equipo=${row[C.device_code]}`);
    }
  }

  // Conteo final
  const [[{d}]] = await conn.execute("SELECT COUNT(*) AS d FROM departments");
  const [[{l}]] = await conn.execute("SELECT COUNT(*) AS l FROM locations");
  const [[{e}]] = await conn.execute("SELECT COUNT(*) AS e FROM employees");
  const [[{q}]] = await conn.execute("SELECT COUNT(*) AS q FROM equipment");
  const [[{a}]] = await conn.execute("SELECT COUNT(*) AS a FROM assignments");

  await conn.end();

  console.log(`\n🎉  Proceso finalizado — OK: ${ok} | Errores: ${errors}`);
  console.log(`\n📊  Registros en BD:`);
  console.log(`     departments : ${d}`);
  console.log(`     locations   : ${l}`);
  console.log(`     employees   : ${e}`);
  console.log(`     equipment   : ${q}`);
  console.log(`     assignments : ${a}`);
}

main().catch(err => {
  console.error("❌  Error fatal:", err.message);
  process.exit(1);
});
