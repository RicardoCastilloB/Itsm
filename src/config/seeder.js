// ============================================================================
// src/config/seeder.js — Runner de seeders
//
// Uso:
//   node src/config/seeder.js up    → ejecutar todos los seeders
//   node src/config/seeder.js down  → revertir todos los seeders
// ============================================================================

'use strict';

const sequelize  = require('./database');
const seeders = [
    require('../seeders/001-default-roles'),
    require('../seeders/002-admin-user'),
];

const queryInterface = sequelize.getQueryInterface();
const command = process.argv[2] || 'up';

(async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ Conexión Sequelize OK');

        if (command === 'up') {
            for (const seeder of seeders) {
                await seeder.up(queryInterface);
            }
            console.log('✅ Todos los seeders aplicados');
        } else if (command === 'down') {
            for (const seeder of [...seeders].reverse()) {
                await seeder.down(queryInterface);
            }
            console.log('✅ Todos los seeders revertidos');
        } else {
            console.error(`Comando desconocido: ${command}. Usa "up" o "down"`);
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Error en seeder:', error);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
})();
