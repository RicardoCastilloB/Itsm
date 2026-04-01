const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CiType = sequelize.define('CiType', {
    id:          { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name:        { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT,        allowNull: true  },
    icon:        { type: DataTypes.STRING(50),  allowNull: true  },
    schemaDef:   { type: DataTypes.JSON,        allowNull: true,  field: 'schema_def' },
}, {
    tableName:   'ci_types',
    underscored: true,
    paranoid:    false,
    timestamps:  true,
});

module.exports = CiType;
