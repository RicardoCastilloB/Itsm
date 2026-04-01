// scripts/create-itsm-extended.js
// Crea todas las tablas ITSM extendidas si no existen
require('dotenv').config();
const sequelize = require('../src/config/database');

const SQL = [
  // ── SERVICE REQUESTS ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS service_requests (
    id              CHAR(36)     NOT NULL PRIMARY KEY,
    ticket_id       CHAR(36)     NULL REFERENCES tickets(id),
    requester_id    CHAR(36)     NOT NULL,
    service_id      CHAR(36)     NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT         NULL,
    status          ENUM('borrador','pendiente_aprobacion','aprobado','en_proceso','completado','rechazado','cancelado')
                                 NOT NULL DEFAULT 'borrador',
    priority        ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
    due_date        DATETIME     NULL,
    completed_at    DATETIME     NULL,
    rejected_reason TEXT         NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME     NULL,
    INDEX idx_sr_requester (requester_id),
    INDEX idx_sr_status    (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS approval_flows (
    id                 CHAR(36)     NOT NULL PRIMARY KEY,
    service_request_id CHAR(36)     NOT NULL,
    approver_id        CHAR(36)     NOT NULL,
    step_order         INT          NOT NULL DEFAULT 1,
    status             ENUM('pendiente','aprobado','rechazado') NOT NULL DEFAULT 'pendiente',
    comments           TEXT         NULL,
    decided_at         DATETIME     NULL,
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_af_sr     (service_request_id),
    INDEX idx_af_approver(approver_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── CHANGE MANAGEMENT ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS changes (
    id                    CHAR(36)     NOT NULL PRIMARY KEY,
    change_number         VARCHAR(30)  NOT NULL UNIQUE,
    title                 VARCHAR(255) NOT NULL,
    description           TEXT         NULL,
    type                  ENUM('normal','estandar','emergencia') NOT NULL DEFAULT 'normal',
    status                ENUM('borrador','pendiente_aprobacion','aprobado','en_implementacion',
                               'implementado','fallido','cancelado','revisado')
                                       NOT NULL DEFAULT 'borrador',
    priority              ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
    risk_level            ENUM('bajo','medio','alto','critico') NOT NULL DEFAULT 'medio',
    requested_by          CHAR(36)     NOT NULL,
    assigned_to           CHAR(36)     NULL,
    planned_start         DATETIME     NULL,
    planned_end           DATETIME     NULL,
    actual_start          DATETIME     NULL,
    actual_end            DATETIME     NULL,
    rollback_plan         TEXT         NULL,
    test_plan             TEXT         NULL,
    implementation_notes  TEXT         NULL,
    post_impl_review      TEXT         NULL,
    cab_approved_at       DATETIME     NULL,
    cab_approved_by       CHAR(36)     NULL,
    created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at            DATETIME     NULL,
    INDEX idx_changes_status     (status),
    INDEX idx_changes_requested  (requested_by)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS change_tickets (
    change_id  CHAR(36) NOT NULL,
    ticket_id  CHAR(36) NOT NULL,
    PRIMARY KEY (change_id, ticket_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── PROBLEM MANAGEMENT ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS problems (
    id                CHAR(36)     NOT NULL PRIMARY KEY,
    problem_number    VARCHAR(30)  NOT NULL UNIQUE,
    title             VARCHAR(255) NOT NULL,
    description       TEXT         NULL,
    status            ENUM('abierto','en_investigacion','conocido','resuelto','cerrado')
                                   NOT NULL DEFAULT 'abierto',
    priority          ENUM('baja','media','alta','critica') NOT NULL DEFAULT 'media',
    assigned_to       CHAR(36)     NULL,
    root_cause        TEXT         NULL,
    workaround        TEXT         NULL,
    resolution        TEXT         NULL,
    resolved_at       DATETIME     NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at        DATETIME     NULL,
    INDEX idx_problems_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS problem_tickets (
    problem_id CHAR(36) NOT NULL,
    ticket_id  CHAR(36) NOT NULL,
    PRIMARY KEY (problem_id, ticket_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS known_errors (
    id             CHAR(36)     NOT NULL PRIMARY KEY,
    problem_id     CHAR(36)     NOT NULL,
    title          VARCHAR(255) NOT NULL,
    symptoms       TEXT         NULL,
    workaround     TEXT         NULL,
    resolution     TEXT         NULL,
    is_published   TINYINT(1)   NOT NULL DEFAULT 0,
    published_at   DATETIME     NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at     DATETIME     NULL,
    INDEX idx_ke_problem (problem_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SERVICE CATALOG ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS service_categories (
    id          CHAR(36)     NOT NULL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT         NULL,
    icon        VARCHAR(50)  NULL,
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS services (
    id              CHAR(36)       NOT NULL PRIMARY KEY,
    category_id     CHAR(36)       NOT NULL,
    name            VARCHAR(150)   NOT NULL,
    description     TEXT           NULL,
    sla_hours       INT            NOT NULL DEFAULT 8,
    approval_required TINYINT(1)   NOT NULL DEFAULT 0,
    approver_role   VARCHAR(50)    NULL,
    form_schema     JSON           NULL,
    is_active       TINYINT(1)     NOT NULL DEFAULT 1,
    created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME       NULL,
    INDEX idx_svc_category (category_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── CMDB ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ci_types (
    id          CHAR(36)     NOT NULL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT         NULL,
    icon        VARCHAR(50)  NULL,
    schema_def  JSON         NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS config_items (
    id            CHAR(36)     NOT NULL PRIMARY KEY,
    ci_type_id    CHAR(36)     NOT NULL,
    name          VARCHAR(150) NOT NULL,
    status        ENUM('activo','inactivo','en_mantenimiento','retirado') NOT NULL DEFAULT 'activo',
    environment   ENUM('produccion','staging','desarrollo','dr') NOT NULL DEFAULT 'produccion',
    owner_id      CHAR(36)     NULL,
    location      VARCHAR(150) NULL,
    ip_address    VARCHAR(45)  NULL,
    serial_number VARCHAR(100) NULL,
    version       VARCHAR(50)  NULL,
    attributes    JSON         NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at    DATETIME     NULL,
    INDEX idx_ci_type   (ci_type_id),
    INDEX idx_ci_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ci_relationships (
    id              CHAR(36)    NOT NULL PRIMARY KEY,
    source_id       CHAR(36)    NOT NULL,
    target_id       CHAR(36)    NOT NULL,
    relationship    ENUM('depende_de','conectado_a','instalado_en','virtualizado_en','contiene','respaldado_por')
                                NOT NULL DEFAULT 'conectado_a',
    created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cir_source (source_id),
    INDEX idx_cir_target (target_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS ticket_ci (
    ticket_id CHAR(36) NOT NULL,
    ci_id     CHAR(36) NOT NULL,
    PRIMARY KEY (ticket_id, ci_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS change_ci (
    change_id CHAR(36) NOT NULL,
    ci_id     CHAR(36) NOT NULL,
    PRIMARY KEY (change_id, ci_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ── SEED: service_categories ─────────────────────────────────────────────
  `INSERT IGNORE INTO service_categories (id, name, description, icon) VALUES
    (UUID(), 'Infraestructura',  'Servidores, almacenamiento y red',          'server'),
    (UUID(), 'Aplicaciones',     'Instalación y soporte de software',         'app-window'),
    (UUID(), 'Accesos',          'Creación y gestión de cuentas y permisos',  'key'),
    (UUID(), 'Hardware',         'Equipos, periféricos y garantías',          'monitor'),
    (UUID(), 'Comunicaciones',   'Email, telefonía y videoconferencia',       'mail'),
    (UUID(), 'Seguridad',        'Incidentes de seguridad y compliance',      'shield')`,

  // ── SEED: ci_types ────────────────────────────────────────────────────────
  `INSERT IGNORE INTO ci_types (id, name, description, icon) VALUES
    (UUID(), 'Servidor Físico',   'Servidor de hardware físico',     'server'),
    (UUID(), 'Servidor Virtual',  'Máquina virtual / VM',            'layers'),
    (UUID(), 'Base de Datos',     'Instancia de base de datos',      'database'),
    (UUID(), 'Aplicación',        'Aplicación o servicio de software','app-window'),
    (UUID(), 'Switch',            'Switch de red',                   'network'),
    (UUID(), 'Router',            'Router o firewall',               'router'),
    (UUID(), 'Storage',           'Sistema de almacenamiento',       'hard-drive'),
    (UUID(), 'Endpoint',          'PC, laptop o workstation',        'monitor')`,
];

async function run() {
  try {
    await sequelize.authenticate();
    for (const sql of SQL) {
      const label = sql.trim().split('\n')[0].substring(0, 70);
      process.stdout.write(`  ↳ ${label}... `);
      await sequelize.query(sql);
      console.log('OK');
    }
    console.log('\n✅ Todas las tablas ITSM extendidas creadas/verificadas.');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
