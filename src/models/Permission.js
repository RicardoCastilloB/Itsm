const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Permission = sequelize.define('Permission', {
        id: {
            type:         DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey:   true,
        },
        nombre: {
            type:      DataTypes.STRING(100),
            allowNull: false,
            unique:    true,
        },
        recurso: {
            type:      DataTypes.STRING(100),
            allowNull: false,
        },
        accion: {
            type:      DataTypes.ENUM('create', 'read', 'update', 'delete', 'manage'),
            allowNull: false,
        },
        descripcion: {
            type:      DataTypes.STRING(255),
            allowNull: true,
        },
    }, {
        tableName: 'permissions',
        paranoid:  true,
    });

    return Permission;
};