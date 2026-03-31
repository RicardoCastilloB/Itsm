// ============================================================================
// Migración 006 — Soft delete (deleted_at) en tablas críticas
// Permite paranoid: true en los modelos Sequelize futuros sin perder datos.
// ============================================================================

'use strict';

const { DataTypes } = require('sequelize');

// Tablas críticas que necesitan soft delete
const TABLES = [
    'employees',
    'equipment',
    'assignments',
    'departments',
    'locations',
    'warranty_records',
    'recoveries',
];

module.exports = {
    async up(queryInterface) {
        for (const table of TABLES) {
            // Verificar que la tabla existe
            const exists = await queryInterface.sequelize.query(
                `SHOW TABLES LIKE '${table}'`,
                { type: 'SELECT' }
            );
            if (!exists.length) {
                console.warn(`⚠️  Tabla ${table} no existe, se omite`);
                continue;
            }

            // Verificar que la columna NO existe ya
            const cols = await queryInterface.sequelize.query(
                `SHOW COLUMNS FROM \`${table}\` LIKE 'deleted_at'`,
                { type: 'SELECT' }
            );
            if (cols.length) {
                console.log(`  ⚠️  deleted_at ya existe en ${table}`);
                continue;
            }

            await queryInterface.addColumn(table, 'deleted_at', {
                type:         DataTypes.DATE,
                allowNull:    true,
                defaultValue: null,
                after:        'updated_at',
            });
            console.log(`  ✅ deleted_at agregado a ${table}`);
        }
    },

    async down(queryInterface) {
        for (const table of TABLES) {
            try {
                await queryInterface.removeColumn(table, 'deleted_at');
            } catch {
                /* ignorar si no existe */
            }
        }
    },
};
