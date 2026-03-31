// ============================================================================
// Seeder 001 — Roles por defecto
// ============================================================================

'use strict';

const { v4: uuidv4 } = require('uuid');

const ROLES = [
    { nombre: 'admin',      descripcion: 'Administrador del sistema — acceso total' },
    { nombre: 'supervisor', descripcion: 'Supervisor — lectura amplia y aprobación de operaciones' },
    { nombre: 'agente',     descripcion: 'Agente de campo — operaciones diarias de equipos y asignaciones' },
    { nombre: 'usuario',    descripcion: 'Usuario final — solo lectura' },
];

module.exports = {
    async up(queryInterface) {
        const now = new Date();

        for (const rol of ROLES) {
            const [existing] = await queryInterface.sequelize.query(
                'SELECT id FROM roles WHERE nombre = ? LIMIT 1',
                { replacements: [rol.nombre], type: 'SELECT' }
            );
            if (!existing) {
                await queryInterface.sequelize.query(
                    'INSERT INTO roles (id, nombre, descripcion, activo, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
                    { replacements: [uuidv4(), rol.nombre, rol.descripcion, now, now] }
                );
                console.log(`  ✅ Rol creado: ${rol.nombre}`);
            } else {
                console.log(`  ⚠️  Rol ya existe: ${rol.nombre}`);
            }
        }
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(
            "DELETE FROM roles WHERE nombre IN ('admin','supervisor','agente','usuario')"
        );
    },
};
