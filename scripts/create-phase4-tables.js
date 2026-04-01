// scripts/create-phase4-tables.js
require('dotenv').config();
const sequelize = require('../src/config/database');

const SQL = [
  // ── NOTIFICATIONS ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
    id          CHAR(36)     NOT NULL PRIMARY KEY,
    user_id     CHAR(36)     NOT NULL,
    type        VARCHAR(50)  NOT NULL,
    title       VARCHAR(255) NOT NULL,
    body        TEXT         NULL,
    data        JSON         NULL,
    is_read     TINYINT(1)   NOT NULL DEFAULT 0,
    read_at     DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notif_user   (user_id),
    INDEX idx_notif_unread (user_id, is_read)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── KNOWLEDGE BASE ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS kb_categories (
    id          CHAR(36)     NOT NULL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT         NULL,
    icon        VARCHAR(50)  NULL DEFAULT 'book',
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS kb_articles (
    id              CHAR(36)      NOT NULL PRIMARY KEY,
    kb_category_id  CHAR(36)      NULL,
    title           VARCHAR(255)  NOT NULL,
    content         LONGTEXT      NOT NULL,
    excerpt         TEXT          NULL,
    tags            VARCHAR(500)  NULL,
    author_id       CHAR(36)      NOT NULL,
    status          ENUM('borrador','publicado','archivado') NOT NULL DEFAULT 'borrador',
    views           INT           NOT NULL DEFAULT 0,
    helpful_yes     INT           NOT NULL DEFAULT 0,
    helpful_no      INT           NOT NULL DEFAULT 0,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME      NULL,
    FULLTEXT idx_kb_search (title, content, tags),
    INDEX idx_kb_cat    (kb_category_id),
    INDEX idx_kb_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS kb_article_tickets (
    article_id CHAR(36) NOT NULL,
    ticket_id  CHAR(36) NOT NULL,
    linked_by  CHAR(36) NULL,
    linked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_id, ticket_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS kb_search_log (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    query      VARCHAR(255) NOT NULL,
    results    INT          NOT NULL DEFAULT 0,
    user_id    CHAR(36)     NULL,
    searched_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_kbsl_query (query)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── CSI — Mejora Continua ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS csi_initiatives (
    id              CHAR(36)     NOT NULL PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    description     TEXT         NULL,
    objective       TEXT         NULL,
    status          ENUM('propuesta','en_progreso','completada','cancelada') NOT NULL DEFAULT 'propuesta',
    priority        ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
    owner_id        CHAR(36)     NULL,
    target_date     DATE         NULL,
    completed_date  DATE         NULL,
    improvement_pct DECIMAL(5,2) NULL COMMENT 'Mejora esperada en %',
    metric          VARCHAR(100) NULL COMMENT 'Métrica a mejorar',
    baseline_value  DECIMAL(10,2) NULL,
    target_value    DECIMAL(10,2) NULL,
    actual_value    DECIMAL(10,2) NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME     NULL,
    INDEX idx_csi_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── REPORT JOBS ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS report_jobs (
    id          CHAR(36)     NOT NULL PRIMARY KEY,
    user_id     CHAR(36)     NOT NULL,
    type        ENUM('csv','excel','pdf') NOT NULL,
    status      ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
    filters     JSON         NULL,
    file_url    VARCHAR(500) NULL,
    row_count   INT          NULL,
    error_msg   TEXT         NULL,
    requested_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME    NULL,
    INDEX idx_rj_user   (user_id),
    INDEX idx_rj_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SEED: kb_categories ────────────────────────────────────────────────────
  `INSERT IGNORE INTO kb_categories (id, name, description, icon, sort_order) VALUES
    (UUID(), 'Redes y Conectividad',   'VPN, WiFi, firewall y troubleshooting de red',   'wifi',         1),
    (UUID(), 'Sistemas Operativos',    'Windows, Linux, drivers y actualizaciones',       'laptop',       2),
    (UUID(), 'Aplicaciones',           'Software corporativo, licencias e instalación',   'app-window',   3),
    (UUID(), 'Seguridad',              'Antivirus, contraseñas y accesos',                'shield-check',  4),
    (UUID(), 'Hardware',               'Impresoras, periféricos y equipos',               'cpu',          5),
    (UUID(), 'Correo y Colaboración',  'Outlook, Teams y Office 365',                    'envelope',     6)`,
];

async function run() {
  try {
    await sequelize.authenticate();
    for (const sql of SQL) {
      const label = sql.trim().split('\n')[0].substring(0, 65);
      process.stdout.write(`  ↳ ${label}... `);
      await sequelize.query(sql);
      console.log('OK');
    }
    console.log('\n✅ Tablas Phase 4 creadas/verificadas.');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}
run();
