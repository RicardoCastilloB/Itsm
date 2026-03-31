// ============================================================================
// src/models/User.js
// ============================================================================

const { DataTypes } = require('sequelize');
const bcrypt       = require('bcrypt');
const sequelize    = require('../config/database');

const User = sequelize.define('User', {
    id: {
        type:         DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey:   true,
    },
    username: {
        type:      DataTypes.STRING(100),
        allowNull: false,
        unique:    true,
    },
    nombre: {
        type:      DataTypes.STRING(150),
        allowNull: false,
        field:     'full_name', // columna en BD: full_name
    },
    email: {
        type:      DataTypes.STRING(255),
        allowNull: false,
        unique:    true,
        validate:  { isEmail: true },
    },
    password: {
        type:      DataTypes.STRING(255),
        allowNull: false,
        field:     'password_hash', // columna en BD: password_hash
    },
    rol: {
        type:         DataTypes.ENUM('admin', 'agente', 'usuario', 'supervisor'),
        allowNull:    false,
        defaultValue: 'usuario',
        field:        'role', // columna en BD: role
    },
    employeeCip: {
        type:         DataTypes.STRING(50),
        allowNull:    true,
        defaultValue: null,
    },
    activo: {
        type:         DataTypes.BOOLEAN,
        allowNull:    false,
        defaultValue: true,
        field:        'is_active', // columna en BD: is_active
    },
    isVerified: {
        type:         DataTypes.BOOLEAN,
        allowNull:    false,
        defaultValue: false,
    },
}, {
    tableName:   'users',
    timestamps:  true,
    underscored: true,
    paranoid:    true, // soft delete: agrega deleted_at

    hooks: {
        // Hashear password antes de crear o actualizar
        beforeCreate: async (user) => {
            if (user.password) {
                user.password = await bcrypt.hash(user.password, 12);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                user.password = await bcrypt.hash(user.password, 12);
            }
        },
    },
});

// Método de instancia: verificar contraseña
User.prototype.verificarPassword = function (passwordPlano) {
    return bcrypt.compare(passwordPlano, this.password);
};

// Método de instancia: serializar para JWT (no exponer password)
User.prototype.toJWT = function () {
    return {
        id:       this.id,
        username: this.username,
        email:    this.email,
        nombre:   this.nombre,
        rol:      this.rol,
    };
};

module.exports = User;
