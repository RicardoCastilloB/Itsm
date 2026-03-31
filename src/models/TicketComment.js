const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TicketComment = sequelize.define('TicketComment', {
    id:       { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ticketId: { type: DataTypes.CHAR(36), allowNull: false },
    userId:   { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
    contenido:{ type: DataTypes.TEXT, allowNull: false },
    tipo:     { type: DataTypes.ENUM('comentario','cambio_estado','asignacion','sistema'), allowNull: false, defaultValue: 'comentario' },
    metadata: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
}, { tableName: 'ticket_comments', timestamps: true, updatedAt: false, underscored: true });

module.exports = TicketComment;
