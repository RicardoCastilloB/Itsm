const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TicketAttachment = sequelize.define('TicketAttachment', {
    id:        { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ticketId:  { type: DataTypes.CHAR(36), allowNull: false },
    userId:    { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
    filename:  { type: DataTypes.STRING(255), allowNull: false },
    original:  { type: DataTypes.STRING(255), allowNull: false },
    mimetype:  { type: DataTypes.STRING(100), allowNull: true },
    sizeBytes: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'ticket_attachments', timestamps: true, updatedAt: false, underscored: true });

module.exports = TicketAttachment;
