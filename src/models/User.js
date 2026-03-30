const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        id: {
            type:         DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey:   true,
        },
        nombre: {
            type:      DataTypes.STRING(100),
            allowNull: false,
        },
        email: {
            type:      DataTypes.STRING(150),
            allowNull: false,
            unique:    true,
            validate:  { isEmail: true },
        },
        password: {
            type:      DataTypes.STRING(255),
            allowNull: false,
        },
        rol: {
            type:         DataTypes.ENUM('admin', 'agente', 'supervisor', 'usuario'),
            defaultValue: 'usuario',
        },
        activo: {
            type:         DataTypes.BOOLEAN,
            defaultValue: true,
        },
    }, {
        tableName: 'users',
        paranoid:  true, // soft delete — agrega deleted_at
    });

    return User;
};