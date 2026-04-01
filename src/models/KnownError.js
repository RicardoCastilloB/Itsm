const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const KnownError = sequelize.define('KnownError', {
    id:          { type: DataTypes.CHAR(36),    primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    problemId:   { type: DataTypes.CHAR(36),    allowNull: false, field: 'problem_id' },
    title:       { type: DataTypes.STRING(255), allowNull: false },
    symptoms:    { type: DataTypes.TEXT,        allowNull: true  },
    workaround:  { type: DataTypes.TEXT,        allowNull: true  },
    resolution:  { type: DataTypes.TEXT,        allowNull: true  },
    isPublished: { type: DataTypes.BOOLEAN,     defaultValue: false, field: 'is_published' },
    publishedAt: { type: DataTypes.DATE,        allowNull: true,     field: 'published_at' },
}, {
    tableName:   'known_errors',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = KnownError;
