// ============================================================================
// scripts/create-phase5-6-tables.js — Fase 5 & 6: Tablas BD
// business_rules, ticket_surveys, daily_stats, ticket_archive
// ============================================================================

const sequelize = require('../src/config/database');

async function run() {
    const q = sequelize.getQueryInterface();

    // ── 1. business_rules ───────────────────────────────────────────────────
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS business_rules (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            name          VARCHAR(150) NOT NULL,
            description   TEXT,
            \`conditions\`  JSON NOT NULL COMMENT 'json-rules-engine conditions object',
            actions       JSON NOT NULL COMMENT 'array of {type, params}',
            is_active     TINYINT(1) NOT NULL DEFAULT 1,
            priority      INT NOT NULL DEFAULT 10 COMMENT 'lower = evaluated first',
            run_on        ENUM('ticket_created','ticket_updated','sla_check') NOT NULL DEFAULT 'ticket_created',
            created_by    CHAR(36),
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅  business_rules');

    // ── 2. ticket_surveys ────────────────────────────────────────────────────
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ticket_surveys (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            ticket_id   CHAR(36) NOT NULL,
            user_id     CHAR(36) NOT NULL,
            rating      TINYINT NOT NULL COMMENT '1-5',
            comment     TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_ticket_survey (ticket_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅  ticket_surveys');

    // ── 3. daily_stats ───────────────────────────────────────────────────────
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS daily_stats (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            stat_date           DATE NOT NULL,
            tickets_created     INT DEFAULT 0,
            tickets_resolved    INT DEFAULT 0,
            tickets_breached    INT DEFAULT 0,
            avg_resolution_h    DECIMAL(8,2) DEFAULT NULL,
            sla_compliance_pct  DECIMAL(5,2) DEFAULT NULL,
            p1_count            INT DEFAULT 0,
            p2_count            INT DEFAULT 0,
            p3_count            INT DEFAULT 0,
            p4_count            INT DEFAULT 0,
            open_at_midnight    INT DEFAULT 0,
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_stat_date (stat_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅  daily_stats');

    // ── 4. ticket_archive ────────────────────────────────────────────────────
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS ticket_archive (
            id            CHAR(36) PRIMARY KEY,
            titulo        VARCHAR(255) NOT NULL,
            descripcion   TEXT,
            tipo          VARCHAR(30),
            status        VARCHAR(30),
            priority      VARCHAR(10),
            category_id   INT,
            category_name VARCHAR(100),
            assigned_to   CHAR(36),
            created_by    CHAR(36),
            sla_status    VARCHAR(20),
            sla_due_at    DATETIME,
            resolved_at   DATETIME,
            closed_at     DATETIME,
            metadata      JSON,
            original_created_at DATETIME,
            archived_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✅  ticket_archive');

    // ── 5. Seed de reglas por defecto ────────────────────────────────────────
    const [existing] = await sequelize.query(`SELECT COUNT(*) as c FROM business_rules`);
    if (existing[0].c === 0) {
        await sequelize.query(`
            INSERT INTO business_rules (name, description, \`conditions\`, actions, priority, run_on) VALUES
            (
                'Escalado P1 sin agente',
                'Si prioridad P1 y sin agente asignado después de 15 min → escalar a supervisor',
                '{"all":[{"fact":"priority","operator":"equal","value":"P1"},{"fact":"assignedTo","operator":"equal","value":null},{"fact":"ageMinutes","operator":"greaterThanInclusive","value":15}]}',
                '[{"type":"notify_role","params":{"role":"supervisor","message":"Ticket P1 sin agente asignado"}},{"type":"set_sla_status","params":{"status":"riesgo"}}]',
                1, 'sla_check'
            ),
            (
                'Enrutamiento Redes',
                'Si categoría contiene Redes → asignar al grupo de red',
                '{"all":[{"fact":"categoryName","operator":"contains","value":"Red"}]}',
                '[{"type":"assign_group","params":{"group":"redes"}},{"type":"add_tag","params":{"tag":"redes"}}]',
                5, 'ticket_created'
            ),
            (
                'Cliente VIP sube prioridad',
                'Si usuario tiene rol VIP o tag VIP → subir prioridad un nivel',
                '{"all":[{"fact":"creatorTag","operator":"equal","value":"vip"}]}',
                '[{"type":"upgrade_priority","params":{"levels":1}},{"type":"add_comment","params":{"text":"Prioridad elevada automáticamente por regla VIP"}}]',
                3, 'ticket_created'
            );
        `);
        console.log('✅  Reglas por defecto insertadas (3)');
    }

    console.log('\n🎉  Fase 5-6 tables OK');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
