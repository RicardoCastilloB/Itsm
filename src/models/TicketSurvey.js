const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TicketSurvey = sequelize.define('TicketSurvey', {
    id:       { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ticketId: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    userId:   { type: DataTypes.CHAR(36), allowNull: false },
    rating:   { type: DataTypes.TINYINT, allowNull: false, validate: { min: 1, max: 5 } },
    comment:  { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    skipped:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
    tableName:  'ticket_surveys',
    timestamps: true,
    updatedAt:  false,
    underscored: true,
});

module.exports = TicketSurvey;
