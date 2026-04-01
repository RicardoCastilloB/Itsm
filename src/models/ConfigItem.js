const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ConfigItem = sequelize.define('ConfigItem', {
    id:           { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    ciTypeId:     { type: DataTypes.CHAR(36),    allowNull: false, field: 'ci_type_id' },
    name:         { type: DataTypes.STRING(150), allowNull: false },
    status: {
        type: DataTypes.ENUM('activo','inactivo','en_mantenimiento','retirado'),
        defaultValue: 'activo',
    },
    environment: {
        type: DataTypes.ENUM('produccion','staging','desarrollo','dr'),
        defaultValue: 'produccion',
    },
    ownerId:      { type: DataTypes.CHAR(36),    allowNull: true,  field: 'owner_id' },
    location:     { type: DataTypes.STRING(150), allowNull: true  },
    ipAddress:    { type: DataTypes.STRING(45),  allowNull: true,  field: 'ip_address' },
    serialNumber: { type: DataTypes.STRING(100), allowNull: true,  field: 'serial_number' },
    version:      { type: DataTypes.STRING(50),  allowNull: true  },
    attributes:   { type: DataTypes.JSON,        allowNull: true  },
}, {
    tableName:   'config_items',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = ConfigItem;
