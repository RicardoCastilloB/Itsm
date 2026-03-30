/********************************************
 * 1. Importaciones y configuración inicial
 ********************************************/
const mysql = require('mysql2/promise');
require('dotenv').config();

/********************************************
 * 2. Configuración del pool de conexión
 ********************************************/
const equipmentPool = mysql.createPool({
  host:     process.env.EQUIPMENT_HOST     || 'localhost',
  user:     process.env.EQUIPMENT_USER     || 'root',
  password: process.env.EQUIPMENT_PASSWORD,
  database: process.env.EQUIPMENT_DATABASE || 'equipment_management',
  port:     process.env.EQUIPMENT_PORT     || 3306,
  waitForConnections:    true,
  connectionLimit:       15,      // era 10
  queueLimit:            0,
  connectTimeout:        10000,   // nuevo: 10s timeout de conexión
  enableKeepAlive:       true,
  keepAliveInitialDelay: 30000    // era 0, ahora cada 30s
});

/********************************************
 * 3. Función para probar la conexión
 ********************************************/
async function testEquipmentConnection() {
  try {
    const connection = await equipmentPool.getConnection();
    console.log('✅ Conexión exitosa a Equipment Management');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Error conectando a Equipment Management:', error.message);
    return false;
  }
}

/********************************************
 * 4. Ejecutar consultas generales (SELECT, UPDATE, etc.)
 ********************************************/
async function executeQuery(pool, query, params = []) {
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute(query, params);
    return results;
  } catch (error) {
    console.error('Error en query:', error.message);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

/********************************************
 * 5. Ejecutar procedimientos almacenados (CALL)
 ********************************************/
async function callStoredProcedure(pool, procedureName, params = []) {
  let connection;
  try {
    connection = await pool.getConnection();
    const placeholders = params.map(() => '?').join(', ');
    const query = `CALL ${procedureName}(${placeholders})`;
    const [results] = await connection.execute(query, params);
    return results;
  } catch (error) {
    console.error(`Error ejecutando SP ${procedureName}:`, error.message);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

/********************************************
 * 6. Ejecutar transacciones SQL
 ********************************************/
async function executeTransaction(pool, callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/********************************************
 * 7. Prueba automática de la conexión
 ********************************************/
(async () => {
  console.log('\n Probando conexiones a bases de datos...\n');
  
  await testEquipmentConnection();
  console.log('');
})();

/********************************************
 * 8. Exportación de funciones y pool
 ********************************************/
module.exports = {
  equipmentPool,
  executeQuery,
  callStoredProcedure,
  executeTransaction,
  testEquipmentConnection
};
