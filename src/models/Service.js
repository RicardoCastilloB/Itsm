const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Service = sequelize.define('Service', {
    id:               { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    categoryId:       { type: DataTypes.CHAR(36),    allowNull: false, field: 'category_id' },
    name:             { type: DataTypes.STRING(150), allowNull: false },
    description:      { type: DataTypes.TEXT,        allowNull: true  },
    slaHours:         { type: DataTypes.INTEGER,     defaultValue: 8,  field: 'sla_hours' },
    approvalRequired: { type: DataTypes.BOOLEAN,     defaultValue: false, field: 'approval_required' },
    approverRole:     { type: DataTypes.STRING(50),  allowNull: true,  field: 'approver_role' },
    formSchema:       { type: DataTypes.JSON,        allowNull: true,  field: 'form_schema' },
    isActive:         { type: DataTypes.BOOLEAN,     defaultValue: true, field: 'is_active' },
}, {
    tableName:   'services',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = Service;
