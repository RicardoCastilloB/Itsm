// ============================================================================
// src/config/migrator.js — Runner de migraciones con Umzug
// Uso desde CLI:
//   node -e "require('./src/config/migrator').up()"     → aplicar pendientes
//   node -e "require('./src/config/migrator').down()"   → revertir última
// ============================================================================

const { Umzug, SequelizeStorage } = require('umzug');
const path     = require('path');
const sequelize = require('./database');

const umzug = new Umzug({
    migrations: {
        // path.join usa backslashes en Windows — glob necesita forward slashes
        glob: path.join(__dirname, '../migrations/*.js').replace(/\\/g, '/'),
        resolve: ({ name, path: migrationPath, context }) => {
            const migration = require(migrationPath);
            return {
                name,
                up:   async () => migration.up(context,   sequelize),
                down: async () => migration.down(context, sequelize),
            };
        },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger:  console,
});

// Ejecutar desde CLI directamente: node src/config/migrator.js
if (require.main === module) {
    umzug.runAsCLI();
}

module.exports = umzug;
