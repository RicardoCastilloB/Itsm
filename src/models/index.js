// ============================================================================
// src/models/index.js — Carga automática de modelos y asociaciones
// ============================================================================

const sequelize = require('../config/database');

// Importar modelos
const Role             = require('./Role');
const Permission       = require('./Permission');
const User             = require('./User');
const AuditLog         = require('./AuditLog');
const Category         = require('./Category');
const SLAPolicy        = require('./SLAPolicy');
const Ticket           = require('./Ticket');
const TicketComment    = require('./TicketComment');
const TicketAttachment = require('./TicketAttachment');

// ============================================================================
// ASOCIACIONES
// ============================================================================

// Role ↔ Permission (1:N)
Role.hasMany(Permission, { foreignKey: 'roleId', as: 'permisos' });
Permission.belongsTo(Role, { foreignKey: 'roleId', as: 'rol' });

// User ↔ AuditLog (1:N)
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'logs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'usuario' });

// Ticket ↔ Category (N:1)
Ticket.belongsTo(Category, { foreignKey: 'categoryId', as: 'categoria' });
Category.hasMany(Ticket,   { foreignKey: 'categoryId', as: 'tickets' });

// Ticket ↔ TicketComment (1:N)
Ticket.hasMany(TicketComment,       { foreignKey: 'ticketId', as: 'comentarios' });
TicketComment.belongsTo(Ticket,     { foreignKey: 'ticketId', as: 'ticket' });

// Ticket ↔ TicketAttachment (1:N)
Ticket.hasMany(TicketAttachment,    { foreignKey: 'ticketId', as: 'adjuntos' });
TicketAttachment.belongsTo(Ticket,  { foreignKey: 'ticketId', as: 'ticket' });

// ============================================================================
// EXPORTAR
// ============================================================================

module.exports = {
    sequelize,
    Role,
    Permission,
    User,
    AuditLog,
    Category,
    SLAPolicy,
    Ticket,
    TicketComment,
    TicketAttachment,
};
