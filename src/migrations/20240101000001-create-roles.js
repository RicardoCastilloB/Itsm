// ============================================================================
// Migración 001 — Tabla: roles
// ============================================================================

'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
    async up(queryInterface) {
        await queryInterface.createTable('roles', {
            id: {
                type:          DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey:    true,
            },
            nombre: {
                type:      DataTypes.STRING(50),
                allowNull: false,
                unique:    true,
            },
            descripcion: {
                type:         DataTypes.STRING(255),
                allowNull:    true,
                defaultValue: null,
            },
            activo: {
                type:         DataTypes.BOOLEAN,
                allowNull:    false,
                defaultValue: true,
            },
            created_at: {
                type:         DataTypes.DATE,
                allowNull:    false,
                defaultValue: DataTypes.NOW,
            },
            updated_at: {
                type:         DataTypes.DATE,
                allowNull:    false,
                defaultValue: DataTypes.NOW,
            },
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('roles');
    },
};
