const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Role = sequelize.define('Role', {
        id: {
            type:         DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey:   true,
        },
        nombre: {
            type:      DataTypes.STRING(50),
            allowNull: false,
            unique:    true,
        },
        descripcion: {
            type:      DataTypes.STRING(255),
            allowNull: true,
        },
        activo: {
            type:         DataTypes.BOOLEAN,
            defaultValue: true,
        },
    }, {
        tableName: 'roles',
        paranoid:  true,
    });

    return Role;
};