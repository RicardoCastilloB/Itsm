const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CiRelationship = sequelize.define('CiRelationship', {
    id:           { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    sourceId:     { type: DataTypes.CHAR(36), allowNull: false, field: 'source_id' },
    targetId:     { type: DataTypes.CHAR(36), allowNull: false, field: 'target_id' },
    relationship: {
        type: DataTypes.ENUM('depende_de','conectado_a','instalado_en','virtualizado_en','contiene','respaldado_por'),
        defaultValue: 'conectado_a',
    },
}, {
    tableName:   'ci_relationships',
    underscored: true,
    paranoid:    false,
    timestamps:  true,
    updatedAt:   false,
    createdAt:   'created_at',
});

module.exports = CiRelationship;
