const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Ticket = sequelize.define('Ticket', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    titulo:      { type: DataTypes.STRING(255), allowNull: false },
    descripcion: { type: DataTypes.TEXT, allowNull: true },
    tipo:        { type: DataTypes.ENUM('incidente','solicitud','cambio','problema'), allowNull: false, defaultValue: 'incidente' },
    status:      { type: DataTypes.ENUM('abierto','en_progreso','pendiente','resuelto','cerrado'), allowNull: false, defaultValue: 'abierto' },
    priority:    { type: DataTypes.ENUM('P1','P2','P3','P4'), allowNull: false, defaultValue: 'P3' },
    categoryId:  { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    assignedTo:  { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
    createdBy:   { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
    slaStatus:   { type: DataTypes.ENUM('ok','riesgo','vencido'), allowNull: false, defaultValue: 'ok' },
    slaDueAt:    { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    resolvedAt:  { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    closedAt:    { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    metadata:    {
        type: DataTypes.JSON, allowNull: true, defaultValue: null,
    },
}, {
    tableName:   'tickets',
    timestamps:  true,
    underscored: true,
    paranoid:    true,
});

module.exports = Ticket;
