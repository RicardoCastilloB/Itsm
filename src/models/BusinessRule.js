const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BusinessRule = sequelize.define('BusinessRule', {
    id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name:        { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    conditions:  { type: DataTypes.JSON, allowNull: false, comment: 'json-rules-engine conditions object' },
    actions:     { type: DataTypes.JSON, allowNull: false, comment: 'array of {type, params}' },
    isActive:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    priority:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10, comment: 'lower = evaluated first' },
    runOn:       {
        type:         DataTypes.ENUM('ticket_created', 'ticket_updated', 'sla_check'),
        allowNull:    false,
        defaultValue: 'ticket_created',
    },
    createdBy:   { type: DataTypes.CHAR(36), allowNull: true, defaultValue: null },
}, {
    tableName:   'business_rules',
    timestamps:  true,
    underscored: true,
});

module.exports = BusinessRule;
