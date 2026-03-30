const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const AuditLog = sequelize.define('AuditLog', {
        id: {
            type:         DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey:   true,
        },
usuario_id: {
    type:      DataTypes.INTEGER,
    allowNull: true,
},
        usuario_email: {
            type:      DataTypes.STRING(150),
            allowNull: true,
        },
        accion: {
            type:      DataTypes.STRING(100),
            allowNull: false,
        },
        recurso: {
            type:      DataTypes.STRING(100),
            allowNull: false,
        },
        recurso_id: {
            type:      DataTypes.STRING(100),
            allowNull: true,
        },
        datos_anteriores: {
            type:      DataTypes.JSON,
            allowNull: true,
        },
        datos_nuevos: {
            type:      DataTypes.JSON,
            allowNull: true,
        },
        ip: {
            type:      DataTypes.STRING(45),
            allowNull: true,
        },
        resultado: {
            type:         DataTypes.ENUM('success', 'error'),
            defaultValue: 'success',
        },
    }, {
        tableName: 'audit_logs',
        paranoid:  false, // los logs nunca se borran
    });

    return AuditLog;
};