const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SLAPolicy = sequelize.define('SLAPolicy', {
    id:                 { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    prioridad:          { type: DataTypes.ENUM('P1','P2','P3','P4'), allowNull: false, unique: true },
    tiempoRespuestaH:   { type: DataTypes.DECIMAL(5,2), allowNull: false },
    tiempoResolucionH:  { type: DataTypes.DECIMAL(5,2), allowNull: false },
}, { tableName: 'sla_policies', timestamps: true, underscored: true });

module.exports = SLAPolicy;
