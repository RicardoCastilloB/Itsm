/**
 * test_insert.js
 * Prueba insertar UNA fila hardcodeada para ver el error exacto
 * USO: node test_insert.js
 */

const mysql = require("mysql2/promise");

const DB_CONFIG = {
  host:     "localhost",
  port:     3306,
  user:     "ricardo",
  password: "Misbubus6",
  database: "equipment_management",
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log("✅ Conectado\n");

  // ── 1. DEPARTMENT ──────────────────────────────────────────────────────────
  console.log("── Insertando department...");
  try {
    const [r] = await conn.execute(
      `INSERT INTO departments
         (department_name, division, subactivity, is_active,
          desc_ceo, desc_ceo_1, desc_ceo_2, desc_ceo_3,
          desc_ceo_4, desc_ceo_5, desc_ceo_6, desc_ceo_7)
       VALUES (?,?,?,1,?,?,?,?,?,?,?,?)`,
      [
        "SUPERVISION O&M NOR ORIENTE 2",
        "TECNOLOGIA",
        "Operación de red",
        "PRESIDENCIA",
        "GERENCIA GENERAL",
        "CHIEF OPERATING OFFICER",
        "DIRECCION DE TECNOLOGIA",
        "GERENCIA DE OPERACION Y MANTENIMIENTO",
        "JEFATURA O&M NOR ORIENTE",
        "SUPERVISION O&M NOR ORIENTE 2",
        null,
        null,
      ]
    );
    console.log("   ✅ department insertado, id:", r.insertId);
    var deptId = r.insertId;
  } catch(e) {
    console.error("   ❌ department ERROR:", e.message);
    console.error("      SQL State:", e.sqlState, "| Code:", e.code);
    await conn.end(); return;
  }

  // ── 2. LOCATION ────────────────────────────────────────────────────────────
  console.log("── Insertando location...");
  try {
    const [r] = await conn.execute(
      `INSERT INTO locations (branch_office_id, location_name, city, state, country, is_active)
       VALUES (?,?,?,?,'Perú',1)`,
      ["CT Trujillo", "CT Trujillo", "Trujillo", "Trujillo"]
    );
    console.log("   ✅ location insertada, id:", r.insertId);
    var locId = r.insertId;
  } catch(e) {
    console.error("   ❌ location ERROR:", e.message);
    console.error("      SQL State:", e.sqlState, "| Code:", e.code);
    await conn.end(); return;
  }

  // ── 3. EMPLOYEE ────────────────────────────────────────────────────────────
  console.log("── Insertando employee...");
  try {
    const [r] = await conn.execute(
      `INSERT INTO employees
         (cip, national_id, document_type, full_name, email, network_account,
          position_name, category, employee_group, legal_entity, supervisor_name,
          branch_office_id, state, department_id, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        "007005900",
        "02830740",
        "DNI",
        "TATIANA DEL SOCORRO SAMANAMUD RAMIREZ",
        "tatiana.samanamud@telefonica.com",
        "tsamanamud",
        "ANALISTA DE ADMINISTRACION",
        "Analista Funcional",
        "EMP",
        "T. PERU",
        "GUILLERMO ROMERO",
        "CT Trujillo",
        "Trujillo",
        deptId,
      ]
    );
    console.log("   ✅ employee insertado, id:", r.insertId);
    var empId = r.insertId;
  } catch(e) {
    console.error("   ❌ employee ERROR:", e.message);
    console.error("      SQL State:", e.sqlState, "| Code:", e.code);
    await conn.end(); return;
  }

  // ── 4. EQUIPMENT ───────────────────────────────────────────────────────────
  console.log("── Insertando equipment...");
  try {
    const [r] = await conn.execute(
      `INSERT INTO equipment
         (device_code, model, serial_number, processor, operating_system,
          disk_capacity, ram_memory, equipment_type, brand, acquisition_type,
          obsolescence_years, domain, it_level_1, it_level_2, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Disponible')`,
      [
        "DN000820",
        "Latitude 5490",
        "782J5S2",
        "Intel(R) Core(TM) i5-7300U CPU @ 2.60GHz",
        "Windows 11 Enterprise",
        "500 GB",
        "8GB",
        "Laptop",
        "Dell",
        "Propio",
        7,
        "GP.INET",
        "IT Workplace",
        "Hardware | Computador",
      ]
    );
    console.log("   ✅ equipment insertado, id:", r.insertId);
    var eqpId = r.insertId;
  } catch(e) {
    console.error("   ❌ equipment ERROR:", e.message);
    console.error("      SQL State:", e.sqlState, "| Code:", e.code);
    await conn.end(); return;
  }

  // ── 5. ASSIGNMENT ──────────────────────────────────────────────────────────
  console.log("── Insertando assignment...");
  try {
    const [r] = await conn.execute(
      `INSERT INTO assignments
         (employee_id, equipment_id, department_id, location_id,
          period, relation_type, status, assignment_date)
       VALUES (?,?,?,?,?,?,?,CURDATE())`,
      [empId, eqpId, deptId, locId, "202509", "Equipo Unico", "Activo"]
    );
    console.log("   ✅ assignment insertado, id:", r.insertId);
  } catch(e) {
    console.error("   ❌ assignment ERROR:", e.message);
    console.error("      SQL State:", e.sqlState, "| Code:", e.code);
    await conn.end(); return;
  }

  // ── VERIFICACIÓN FINAL ─────────────────────────────────────────────────────
  console.log("\n📊 Verificación final:");
  for (const t of ["departments","locations","employees","equipment","assignments"]) {
    const [[{cnt}]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
    console.log(`   ${t}: ${cnt}`);
  }

  await conn.end();
  console.log("\n✅ Test completo.");
}

main().catch(e => { console.error("❌ Error fatal:", e.message); process.exit(1); });
