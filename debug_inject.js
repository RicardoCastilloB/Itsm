/**
 * debug_inject.js
 * Diagnóstico: verifica conexión, BD activa, y hace un INSERT de prueba real.
 * USO: node debug_inject.js
 */

const mysql = require("mysql2/promise");

const DB_CONFIG = {
  host: "localhost",
  port: 3306,
  user: "ricardo",
  password: "Misbubus6",
  database: "equipment_management",
  waitForConnections: true,
  connectionLimit: 5,
};

async function main() {
  console.log("🔍 Intentando conectar a:", DB_CONFIG.host, "BD:", DB_CONFIG.database);

  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log("✅ Conexión exitosa\n");

    // 1. ¿En qué BD estamos realmente?
    const [[{ db }]] = await conn.execute("SELECT DATABASE() AS db");
    console.log("📌 Base de datos activa:", db);

    // 2. ¿Existen las tablas?
    const [tables] = await conn.execute(
      `SELECT TABLE_NAME, TABLE_ROWS 
       FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = ? 
         AND TABLE_NAME IN ('employees','equipment','assignments','departments','locations')`,
      [db]
    );
    console.log("\n📋 Tablas encontradas:");
    if (tables.length === 0) {
      console.log("  ❌ NO SE ENCONTRÓ NINGUNA TABLA — verifica el nombre de la BD");
    } else {
      tables.forEach(t => console.log(`  - ${t.TABLE_NAME} (aprox. ${t.TABLE_ROWS} filas)`));
    }

    // 3. COUNT real de cada tabla
    console.log("\n📊 COUNT(*) real por tabla:");
    for (const tbl of ["departments", "locations", "employees", "equipment", "assignments"]) {
      try {
        const [[{ cnt }]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
        console.log(`  ${tbl}: ${cnt} registros`);
      } catch (e) {
        console.log(`  ${tbl}: ❌ ERROR — ${e.message}`);
      }
    }

    // 4. Verificar autocommit
    const [[{ autocommit }]] = await conn.execute("SELECT @@autocommit AS autocommit");
    console.log("\n⚙️  autocommit:", autocommit === 1 ? "ON ✅" : "OFF ⚠️");

    // 5. Motor de las tablas (InnoDB soporta transacciones, MyISAM NO)
    const [engines] = await conn.execute(
      `SELECT TABLE_NAME, ENGINE 
       FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = ? 
         AND TABLE_NAME IN ('employees','equipment','assignments','departments','locations')`,
      [db]
    );
    console.log("\n🔧 Motor de tablas:");
    engines.forEach(t => {
      const warn = t.ENGINE !== "InnoDB" ? " ⚠️ NO soporta transacciones!" : " ✅";
      console.log(`  - ${t.TABLE_NAME}: ${t.ENGINE}${warn}`);
    });

    // 6. INSERT de prueba real en departments
    console.log("\n🧪 Probando INSERT directo en departments...");
    try {
      const [r] = await conn.execute(
        `INSERT INTO departments (department_name, is_active) VALUES ('__TEST__', 0)`
      );
      console.log("  INSERT OK — insertId:", r.insertId);

      const [[{ cnt }]] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM departments WHERE department_name = '__TEST__'`
      );
      console.log("  SELECT después de INSERT:", cnt, "filas — ", cnt > 0 ? "✅ Datos persisten" : "❌ No persiste");

      // Limpia el registro de prueba
      await conn.execute(`DELETE FROM departments WHERE department_name = '__TEST__'`);
      console.log("  Registro de prueba eliminado.");
    } catch (e) {
      console.log("  ❌ INSERT falló:", e.message);
      console.log("  → Verifica permisos INSERT del usuario o estructura de la tabla.");
    }

  } catch (err) {
    console.error("❌ Error de conexión:", err.message);
    console.error("   Verifica host, puerto, usuario y contraseña en DB_CONFIG.");
  } finally {
    if (conn) await conn.end();
  }
}

main();
