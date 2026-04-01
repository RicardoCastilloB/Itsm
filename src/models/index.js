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
// Phase 4
const Notification     = require('./Notification');
const KbCategory       = require('./KbCategory');
const KbArticle        = require('./KbArticle');
const CsiInitiative    = require('./CsiInitiative');
const ReportJob        = require('./ReportJob');
// Phase 5-6
const BusinessRule     = require('./BusinessRule');
const TicketSurvey     = require('./TicketSurvey');
// ITSM extendido
const ServiceRequest   = require('./ServiceRequest');
const ApprovalFlow     = require('./ApprovalFlow');
const Change           = require('./Change');
const Problem          = require('./Problem');
const KnownError       = require('./KnownError');
const ServiceCategory  = require('./ServiceCategory');
const Service          = require('./Service');
const CiType           = require('./CiType');
const ConfigItem       = require('./ConfigItem');
const CiRelationship   = require('./CiRelationship');

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

// ServiceRequest ↔ ApprovalFlow (1:N)
ServiceRequest.hasMany(ApprovalFlow,  { foreignKey: 'serviceRequestId', as: 'approvals' });
ApprovalFlow.belongsTo(ServiceRequest,{ foreignKey: 'serviceRequestId', as: 'solicitud' });

// ServiceCategory ↔ Service (1:N)
ServiceCategory.hasMany(Service,    { foreignKey: 'categoryId', as: 'servicios' });
Service.belongsTo(ServiceCategory,  { foreignKey: 'categoryId', as: 'categoria' });

// Problem ↔ KnownError (1:N)
Problem.hasMany(KnownError,    { foreignKey: 'problemId', as: 'erroresConocidos' });
KnownError.belongsTo(Problem,  { foreignKey: 'problemId', as: 'problema' });

// KbCategory ↔ KbArticle (1:N)
KbCategory.hasMany(KbArticle, { foreignKey: 'kbCategoryId', as: 'articulos' });
KbArticle.belongsTo(KbCategory, { foreignKey: 'kbCategoryId', as: 'categoria' });

// Ticket ↔ TicketSurvey (1:1)
Ticket.hasOne(TicketSurvey, { foreignKey: 'ticketId', as: 'encuesta' });
TicketSurvey.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });

// CiType ↔ ConfigItem (1:N)
CiType.hasMany(ConfigItem,     { foreignKey: 'ciTypeId', as: 'configItems' });
ConfigItem.belongsTo(CiType,   { foreignKey: 'ciTypeId', as: 'tipo' });

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
    ServiceRequest,
    ApprovalFlow,
    Change,
    Problem,
    KnownError,
    ServiceCategory,
    Service,
    CiType,
    ConfigItem,
    CiRelationship,
    Notification,
    KbCategory,
    KbArticle,
    CsiInitiative,
    ReportJob,
    BusinessRule,
    TicketSurvey,
};
