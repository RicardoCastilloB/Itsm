// ============================================================================
// Migración 004 — Tabla: audit_logs
// ============================================================================

'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
    async up(queryInterface) {
        await queryInterface.createTable('audit_logs', {
            id: {
                type:          DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey:    true,
            },
            user_id: {
                type:       DataTypes.UUID,
                allowNull:  true,
                references: { model: 'users', key: 'id' },
                onDelete:   'SET NULL',
                onUpdate:   'CASCADE',
            },
            accion: {
                type:      DataTypes.STRING(100),
                allowNull: false,
            },
            recurso: {
                type:         DataTypes.STRING(100),
                allowNull:    true,
                defaultValue: null,
            },
            recurso_id: {
                type:         DataTypes.STRING(100),
                allowNull:    true,
                defaultValue: null,
            },
            detalles: {
                type:         DataTypes.TEXT,
                allowNull:    true,
                defaultValue: null,
            },
            ip: {
                type:         DataTypes.STRING(45),
                allowNull:    true,
                defaultValue: null,
            },
            user_agent: {
                type:         DataTypes.STRING(500),
                allowNull:    true,
                defaultValue: null,
            },
            created_at: {
                type:         DataTypes.DATE,
                allowNull:    false,
                defaultValue: DataTypes.NOW,
            },
        });

        await queryInterface.addIndex('audit_logs', ['user_id'],   { name: 'idx_audit_user' });
        await queryInterface.addIndex('audit_logs', ['accion'],    { name: 'idx_audit_accion' });
        await queryInterface.addIndex('audit_logs', ['created_at'],{ name: 'idx_audit_created' });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('audit_logs');
    },
};
