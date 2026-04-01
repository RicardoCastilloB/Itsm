const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Change = sequelize.define('Change', {
    id:                  { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    changeNumber:        { type: DataTypes.STRING(30),  allowNull: false, unique: true, field: 'change_number' },
    title:               { type: DataTypes.STRING(255), allowNull: false },
    description:         { type: DataTypes.TEXT,        allowNull: true  },
    type:                { type: DataTypes.ENUM('normal','estandar','emergencia'), defaultValue: 'normal' },
    status: {
        type: DataTypes.ENUM('borrador','pendiente_aprobacion','aprobado','en_implementacion',
                             'implementado','fallido','cancelado','revisado'),
        defaultValue: 'borrador',
    },
    priority:            { type: DataTypes.ENUM('baja','media','alta','critica'), defaultValue: 'media' },
    riskLevel:           { type: DataTypes.ENUM('bajo','medio','alto','critico'),  defaultValue: 'medio', field: 'risk_level' },
    requestedBy:         { type: DataTypes.CHAR(36),    allowNull: false, field: 'requested_by' },
    assignedTo:          { type: DataTypes.CHAR(36),    allowNull: true,  field: 'assigned_to' },
    plannedStart:        { type: DataTypes.DATE,        allowNull: true,  field: 'planned_start' },
    plannedEnd:          { type: DataTypes.DATE,        allowNull: true,  field: 'planned_end' },
    actualStart:         { type: DataTypes.DATE,        allowNull: true,  field: 'actual_start' },
    actualEnd:           { type: DataTypes.DATE,        allowNull: true,  field: 'actual_end' },
    rollbackPlan:        { type: DataTypes.TEXT,        allowNull: true,  field: 'rollback_plan' },
    testPlan:            { type: DataTypes.TEXT,        allowNull: true,  field: 'test_plan' },
    implementationNotes: { type: DataTypes.TEXT,        allowNull: true,  field: 'implementation_notes' },
    postImplReview:      { type: DataTypes.TEXT,        allowNull: true,  field: 'post_impl_review' },
    cabApprovedAt:       { type: DataTypes.DATE,        allowNull: true,  field: 'cab_approved_at' },
    cabApprovedBy:       { type: DataTypes.CHAR(36),    allowNull: true,  field: 'cab_approved_by' },
}, {
    tableName:   'changes',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = Change;
