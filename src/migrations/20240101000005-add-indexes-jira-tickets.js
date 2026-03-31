// ============================================================================
// Migración 005 — Índices en jira_tickets
// Sin índices las queries lentas aparecen a partir de ~10k registros.
// ============================================================================

'use strict';

module.exports = {
    async up(queryInterface) {
        // Verificar que la tabla existe antes de agregar índices
        const tableDesc = await queryInterface.sequelize.query(
            "SHOW TABLES LIKE 'jira_tickets'",
            { type: 'SELECT' }
        );
        if (!tableDesc.length) {
            console.warn('⚠️  Tabla jira_tickets no existe, se omite la migración de índices');
            return;
        }

        const addIndexSafe = async (table, fields, name) => {
            try {
                await queryInterface.addIndex(table, fields, { name });
                console.log(`  ✅ Índice creado: ${name}`);
            } catch (e) {
                if (e.message.includes('Duplicate key name')) {
                    console.log(`  ⚠️  Índice ya existe: ${name}`);
                } else {
                    throw e;
                }
            }
        };

        await addIndexSafe('jira_tickets', ['status'],      'idx_jira_status');
        await addIndexSafe('jira_tickets', ['urgency'],     'idx_jira_urgency');
        await addIndexSafe('jira_tickets', ['urgency_level'], 'idx_jira_urgency_level');
        await addIndexSafe('jira_tickets', ['created_at'],  'idx_jira_created_at');
        await addIndexSafe('jira_tickets', ['reporter'],    'idx_jira_reporter');
        await addIndexSafe('jira_tickets', ['closed_at'],   'idx_jira_closed_at');
    },

    async down(queryInterface) {
        const dropSafe = async (table, name) => {
            try { await queryInterface.removeIndex(table, name); }
            catch { /* ignorar si no existe */ }
        };

        await dropSafe('jira_tickets', 'idx_jira_status');
        await dropSafe('jira_tickets', 'idx_jira_urgency');
        await dropSafe('jira_tickets', 'idx_jira_urgency_level');
        await dropSafe('jira_tickets', 'idx_jira_created_at');
        await dropSafe('jira_tickets', 'idx_jira_reporter');
        await dropSafe('jira_tickets', 'idx_jira_closed_at');
    },
};
