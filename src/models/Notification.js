const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
    id:       { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId:   { type: DataTypes.CHAR(36),    allowNull: false, field: 'user_id' },
    type:     { type: DataTypes.STRING(50),  allowNull: false },
    title:    { type: DataTypes.STRING(255), allowNull: false },
    body:     { type: DataTypes.TEXT,        allowNull: true  },
    data:     { type: DataTypes.JSON,        allowNull: true  },
    isRead:   { type: DataTypes.BOOLEAN,     defaultValue: false, field: 'is_read' },
    readAt:   { type: DataTypes.DATE,        allowNull: true,     field: 'read_at' },
}, {
    tableName:   'notifications',
    underscored: true,
    paranoid:    false,
    timestamps:  true,
    updatedAt:   false,
    createdAt:   'created_at',
});

module.exports = Notification;
