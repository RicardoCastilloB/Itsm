/**
 * show_schema.js
 * Muestra el DDL exacto de todas las tablas
 * USO: node show_schema.js
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

  const tables = ["departments","locations","employees","equipment","assignments"];

  for (const t of tables) {
    const [[row]] = await conn.execute(`SHOW CREATE TABLE \`${t}\``);
    console.log("\n" + "=".repeat(70));
    console.log(row["Create Table"]);
  }

  // También muestra columnas con tipo exacto
  console.log("\n\n" + "=".repeat(70));
  console.log("COLUMNAS DETALLADAS:");
  for (const t of tables) {
    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [DB_CONFIG.database, t]
    );
    console.log(`\n── ${t.toUpperCase()} ──`);
    cols.forEach(c => {
      console.log(`  ${c.COLUMN_NAME.padEnd(25)} ${c.COLUMN_TYPE.padEnd(40)} NULL:${c.IS_NULLABLE} DEFAULT:${c.COLUMN_DEFAULT} ${c.EXTRA}`);
    });
  }

  await conn.end();
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
