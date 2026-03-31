// ============================================================================
// Seeder 002 — Usuario administrador inicial
//
// Credenciales por defecto (cambiar en producción via .env):
//   Email:    admin@sistema.local   (o ADMIN_EMAIL en .env)
//   Password: Admin@2024!           (o ADMIN_PASSWORD en .env)
// ============================================================================

'use strict';

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@sistema.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@2024!';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

module.exports = {
    async up(queryInterface) {
        const [existing] = await queryInterface.sequelize.query(
            'SELECT id FROM users WHERE email = ? LIMIT 1',
            { replacements: [ADMIN_EMAIL], type: 'SELECT' }
        );

        if (existing) {
            console.log(`  ⚠️  Usuario admin ya existe (${ADMIN_EMAIL}), se omite`);
            return;
        }

        const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

        // SQL directo para evitar que Sequelize incluya columnas que no existen
        await queryInterface.sequelize.query(
            `INSERT INTO users (id, username, full_name, email, password_hash, role, is_active, is_verified, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'admin', 1, 1, ?, ?)`,
            { replacements: [uuidv4(), ADMIN_USERNAME, 'Administrador del Sistema', ADMIN_EMAIL, passwordHash, now, now] }
        );

        console.log(`  ✅ Usuario admin creado → ${ADMIN_EMAIL}`);
        console.log(`  ⚠️  Cambia la contraseña en producción (ADMIN_PASSWORD en .env)`);
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(
            'DELETE FROM users WHERE email = ?',
            { replacements: [ADMIN_EMAIL] }
        );
    },
};
