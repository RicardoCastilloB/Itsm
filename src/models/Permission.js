// ============================================================================
// src/models/Permission.js
// ============================================================================

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Permission = sequelize.define('Permission', {
    id: {
        type:          DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey:    true,
    },
    roleId: {
        type:       DataTypes.INTEGER,
        allowNull:  false,
        references: { model: 'roles', key: 'id' },
        onDelete:   'CASCADE',
    },
    recurso: {
        type:      DataTypes.STRING(100),
        allowNull: false,
        comment:   'e.g. equipment, employees, assignments',
    },
    accion: {
        type:      DataTypes.STRING(50),
        allowNull: false,
        comment:   'e.g. read, create, update, delete',
    },
}, {
    tableName:   'permissions',
    timestamps:  false,
    underscored: true,
    indexes: [
        { unique: true, fields: ['role_id', 'recurso', 'accion'] },
    ],
});

module.exports = Permission;
