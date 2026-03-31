// ============================================================================
// config/database.js — Capa de acceso a datos
//
// Internamente usa Sequelize (mysql2 dialect).
// Expone la misma API que antes: executeQuery, callStoredProcedure,
// executeTransaction, equipmentPool — las rutas existentes no cambian.
//
// Ventaja: cambiar a PostgreSQL en el futuro = solo cambiar dialect
// en src/config/database.js y ajustar 2-3 tipos de datos en los modelos.
// ============================================================================

const { QueryTypes } = require('sequelize');
const sequelize = require('../src/config/database');
const logger    = require('../utils/logger');

// ============================================================================
// SHIM de pool — mantiene compatibilidad con rutas que usan
// equipmentPool directamente (ej: equipmentPool.query(...))
// ============================================================================
const equipmentPool = {
    query: async (sql, params = []) => {
        const [results, metadata] = await sequelize.query(sql, {
            replacements: params,
            type:         QueryTypes.RAW,
        });
        return [results, metadata];
    },
    getConnection: async () => {
        const t = await sequelize.transaction();
        return {
            execute:          async (sql, params = []) => sequelize.query(sql, { replacements: params, transaction: t, type: QueryTypes.RAW }),
            beginTransaction: async () => {},
            commit:           async () => t.commit(),
            rollback:         async () => t.rollback(),
            release:          () => {},
        };
    },
};

// ============================================================================
// executeQuery — reemplazo directo de mysql2 pool.execute()
// El argumento `pool` se ignora (compatibilidad hacia atrás).
// ============================================================================
async function executeQuery(_pool, sql, params = []) {
    const [results] = await sequelize.query(sql, {
        replacements: params,
        type:         QueryTypes.RAW,
    });
    return results;
}

// ============================================================================
// callStoredProcedure — ejecuta un CALL al procedimiento almacenado
// ============================================================================
async function callStoredProcedure(_pool, procedureName, params = []) {
    const placeholders = params.map(() => '?').join(', ');
    const [results] = await sequelize.query(
        `CALL ${procedureName}(${placeholders})`,
        { replacements: params, type: QueryTypes.RAW }
    );
    return results;
}

// ============================================================================
// executeTransaction — transacción Sequelize con API compatible
// ============================================================================
async function executeTransaction(_pool, callback) {
    const t = await sequelize.transaction();
    const connection = {
        execute: async (sql, params = []) => {
            const [results, meta] = await sequelize.query(sql, {
                replacements: params,
                transaction:  t,
                type:         QueryTypes.RAW,
            });
            return [results, meta];
        },
        beginTransaction: async () => {},
        commit:           async () => t.commit(),
        rollback:         async () => t.rollback(),
        release:          () => {},
    };
    try {
        const result = await callback(connection);
        await t.commit();
        return result;
    } catch (error) {
        await t.rollback();
        throw error;
    }
}

// ============================================================================
// Test de conexión al arrancar
// ============================================================================
async function testEquipmentConnection() {
    try {
        await sequelize.authenticate();
        logger.info('✅ Conexión exitosa a Equipment Management (Sequelize)');
        return true;
    } catch (error) {
        logger.error('❌ Error conectando a Equipment Management:', error.message);
        return false;
    }
}

(async () => {
    console.log('\n Probando conexiones a bases de datos...\n');
    await testEquipmentConnection();
    console.log('');
})();

module.exports = {
    equipmentPool,
    executeQuery,
    callStoredProcedure,
    executeTransaction,
    testEquipmentConnection,
};
