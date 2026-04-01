const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ServiceRequest = sequelize.define('ServiceRequest', {
    id:             { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    ticketId:       { type: DataTypes.CHAR(36), allowNull: true,  field: 'ticket_id' },
    requesterId:    { type: DataTypes.CHAR(36), allowNull: false, field: 'requester_id' },
    serviceId:      { type: DataTypes.CHAR(36), allowNull: true,  field: 'service_id' },
    title:          { type: DataTypes.STRING(255), allowNull: false },
    description:    { type: DataTypes.TEXT, allowNull: true },
    status: {
        type: DataTypes.ENUM('borrador','pendiente_aprobacion','aprobado','en_proceso','completado','rechazado','cancelado'),
        defaultValue: 'borrador',
    },
    priority:       { type: DataTypes.ENUM('baja','media','alta','critica'), defaultValue: 'media' },
    dueDate:        { type: DataTypes.DATE, allowNull: true, field: 'due_date' },
    completedAt:    { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    rejectedReason: { type: DataTypes.TEXT, allowNull: true, field: 'rejected_reason' },
}, {
    tableName:  'service_requests',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = ServiceRequest;
