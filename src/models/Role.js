// ============================================================================
// src/models/Role.js
// ============================================================================

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Role = sequelize.define('Role', {
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
}, {
    tableName:  'roles',
    timestamps: true,
    underscored: true,
});

module.exports = Role;
