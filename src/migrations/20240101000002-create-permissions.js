// ============================================================================
// Migración 002 — Tabla: permissions
// ============================================================================

'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
    async up(queryInterface) {
        // Si la tabla existe pero con esquema incorrecto (sin role_id), la eliminamos
        const tables = await queryInterface.sequelize.query(
            "SHOW TABLES LIKE 'permissions'",
            { type: 'SELECT' }
        );

        if (tables.length > 0) {
            const cols = await queryInterface.sequelize.query(
                "SHOW COLUMNS FROM `permissions` LIKE 'role_id'",
                { type: 'SELECT' }
            );
            if (cols.length === 0) {
                // Tabla existe pero sin role_id — esquema incompatible, recrear
                await queryInterface.dropTable('permissions');
                console.log('  ♻️  Tabla permissions eliminada para recrear con esquema correcto');
            } else {
                console.log('  ⚠️  Tabla permissions ya existe con esquema correcto, se omite');
                return;
            }
        }

        await queryInterface.createTable('permissions', {
            id: {
                type:          DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey:    true,
            },
            role_id: {
                type:      DataTypes.INTEGER,
                allowNull: false,
            },
            recurso: {
                type:      DataTypes.STRING(100),
                allowNull: false,
            },
            accion: {
                type:      DataTypes.STRING(50),
                allowNull: false,
            },
        });

        // FK por separado — más robusto que inline en createTable
        await queryInterface.sequelize.query(
            'ALTER TABLE `permissions` ADD CONSTRAINT `fk_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'
        );

        await queryInterface.sequelize.query(
            'CREATE UNIQUE INDEX `idx_permissions_unique` ON `permissions` (`role_id`, `recurso`, `accion`)'
        );
    },

    async down(queryInterface) {
        await queryInterface.dropTable('permissions');
    },
};
