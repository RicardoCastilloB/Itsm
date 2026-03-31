// ============================================================================
// src/models/AuditLog.js
// Registra todas las acciones importantes para trazabilidad ITSM.
// ============================================================================

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditLog = sequelize.define('AuditLog', {
    id: {
        type:          DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey:    true,
    },
    userId: {
        type:       DataTypes.UUID,
        allowNull:  true, // null si la acción es del sistema
        references: { model: 'users', key: 'id' },
        onDelete:   'SET NULL',
    },
    accion: {
        type:      DataTypes.STRING(100),
        allowNull: false,
        comment:   'e.g. login, create_equipment, delete_assignment',
    },
    recurso: {
        type:         DataTypes.STRING(100),
        allowNull:    true,
        defaultValue: null,
        comment:      'e.g. equipment, employees, assignments',
    },
    recursoId: {
        type:         DataTypes.STRING(100),
        allowNull:    true,
        defaultValue: null,
        comment:      'ID del registro afectado',
    },
    detalles: {
        type:         DataTypes.TEXT,
        allowNull:    true,
        defaultValue: null,
        get() {
            const raw = this.getDataValue('detalles');
            try { return raw ? JSON.parse(raw) : null; }
            catch { return raw; }
        },
        set(value) {
            this.setDataValue('detalles',
                value ? JSON.stringify(value) : null
            );
        },
    },
    ip: {
        type:         DataTypes.STRING(45), // soporta IPv6
        allowNull:    true,
        defaultValue: null,
    },
    userAgent: {
        type:         DataTypes.STRING(500),
        allowNull:    true,
        defaultValue: null,
    },
}, {
    tableName:   'audit_logs',
    timestamps:  true,
    underscored: true,
    updatedAt:   false, // solo createdAt — los logs no se editan
});

module.exports = AuditLog;
