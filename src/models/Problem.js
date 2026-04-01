const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Problem = sequelize.define('Problem', {
    id:            { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    problemNumber: { type: DataTypes.STRING(30),  allowNull: false, unique: true, field: 'problem_number' },
    title:         { type: DataTypes.STRING(255), allowNull: false },
    description:   { type: DataTypes.TEXT,        allowNull: true  },
    status: {
        type: DataTypes.ENUM('abierto','en_investigacion','conocido','resuelto','cerrado'),
        defaultValue: 'abierto',
    },
    priority:      { type: DataTypes.ENUM('baja','media','alta','critica'), defaultValue: 'media' },
    assignedTo:    { type: DataTypes.CHAR(36), allowNull: true,  field: 'assigned_to' },
    rootCause:     { type: DataTypes.TEXT,     allowNull: true,  field: 'root_cause' },
    workaround:    { type: DataTypes.TEXT,     allowNull: true  },
    resolution:    { type: DataTypes.TEXT,     allowNull: true  },
    resolvedAt:    { type: DataTypes.DATE,     allowNull: true,  field: 'resolved_at' },
}, {
    tableName:   'problems',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = Problem;
