const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CsiInitiative = sequelize.define('CsiInitiative', {
    id:             { type: DataTypes.CHAR(36),      primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    title:          { type: DataTypes.STRING(255),   allowNull: false },
    description:    { type: DataTypes.TEXT,          allowNull: true  },
    objective:      { type: DataTypes.TEXT,          allowNull: true  },
    status: {
        type: DataTypes.ENUM('propuesta','en_progreso','completada','cancelada'),
        defaultValue: 'propuesta',
    },
    priority:       { type: DataTypes.ENUM('baja','media','alta','critica'), defaultValue: 'media' },
    ownerId:        { type: DataTypes.CHAR(36),      allowNull: true,  field: 'owner_id' },
    targetDate:     { type: DataTypes.DATEONLY,      allowNull: true,  field: 'target_date' },
    completedDate:  { type: DataTypes.DATEONLY,      allowNull: true,  field: 'completed_date' },
    improvementPct: { type: DataTypes.DECIMAL(5,2),  allowNull: true,  field: 'improvement_pct' },
    metric:         { type: DataTypes.STRING(100),   allowNull: true  },
    baselineValue:  { type: DataTypes.DECIMAL(10,2), allowNull: true,  field: 'baseline_value' },
    targetValue:    { type: DataTypes.DECIMAL(10,2), allowNull: true,  field: 'target_value' },
    actualValue:    { type: DataTypes.DECIMAL(10,2), allowNull: true,  field: 'actual_value' },
}, {
    tableName:   'csi_initiatives',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = CsiInitiative;
