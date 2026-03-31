// ============================================================================
// src/config/database.js — Instancia Sequelize (ORM)
// Complementa config/database.js que usa mysql2/promise para queries directas.
// Esta instancia se usa para: modelos, migraciones y seeders.
// ============================================================================

const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
    process.env.EQUIPMENT_DATABASE || 'equipment_management',
    process.env.EQUIPMENT_USER     || 'root',
    process.env.EQUIPMENT_PASSWORD,
    {
        host:    process.env.EQUIPMENT_HOST || 'localhost',
        port:    parseInt(process.env.EQUIPMENT_PORT) || 3306,
        dialect: 'mysql', // cambiar a 'postgres' en el futuro

        pool: {
            max:     10,
            min:     2,
            acquire: 30000,
            idle:    10000,
        },

        logging: process.env.NODE_ENV === 'development'
            ? (msg) => require('../../utils/logger').debug(msg)
            : false,

        define: {
            underscored:  true,  // snake_case en columnas de BD
            timestamps:   true,  // createdAt / updatedAt automáticos
            freezeTableName: false,
        },

        timezone: process.env.DB_TIMEZONE || '+00:00',
    }
);

module.exports = sequelize;
