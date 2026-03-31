// ============================================================================
// Migración 003 — Tabla: users
// ============================================================================

'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
    async up(queryInterface) {
        await queryInterface.createTable('users', {
            id: {
                type:         DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey:   true,
            },
            username: {
                type:      DataTypes.STRING(100),
                allowNull: false,
                unique:    true,
            },
            full_name: {
                type:      DataTypes.STRING(150),
                allowNull: false,
            },
            email: {
                type:      DataTypes.STRING(255),
                allowNull: false,
                unique:    true,
            },
            password_hash: {
                type:      DataTypes.STRING(255),
                allowNull: false,
            },
            role: {
                type:         DataTypes.ENUM('admin', 'agente', 'usuario', 'supervisor'),
                allowNull:    false,
                defaultValue: 'usuario',
            },
            employee_cip: {
                type:         DataTypes.STRING(50),
                allowNull:    true,
                defaultValue: null,
            },
            is_active: {
                type:         DataTypes.BOOLEAN,
                allowNull:    false,
                defaultValue: true,
            },
            is_verified: {
                type:         DataTypes.BOOLEAN,
                allowNull:    false,
                defaultValue: false,
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
            deleted_at: {
                type:         DataTypes.DATE,
                allowNull:    true,
                defaultValue: null,
            },
        });

        await queryInterface.addIndex('users', ['email'],    { name: 'idx_users_email' });
        await queryInterface.addIndex('users', ['username'], { name: 'idx_users_username' });
        await queryInterface.addIndex('users', ['role'],     { name: 'idx_users_role' });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('users');
    },
};
