const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const KbArticle = sequelize.define('KbArticle', {
    id:           { type: DataTypes.CHAR(36),     primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    kbCategoryId: { type: DataTypes.CHAR(36),     allowNull: true,  field: 'kb_category_id' },
    title:        { type: DataTypes.STRING(255),  allowNull: false },
    content:      { type: DataTypes.TEXT('long'), allowNull: false },
    excerpt:      { type: DataTypes.TEXT,         allowNull: true  },
    tags:         { type: DataTypes.STRING(500),  allowNull: true  },
    authorId:     { type: DataTypes.CHAR(36),     allowNull: false, field: 'author_id' },
    status:       { type: DataTypes.ENUM('borrador','publicado','archivado'), defaultValue: 'borrador' },
    views:        { type: DataTypes.INTEGER,      defaultValue: 0  },
    helpfulYes:   { type: DataTypes.INTEGER,      defaultValue: 0,  field: 'helpful_yes' },
    helpfulNo:    { type: DataTypes.INTEGER,      defaultValue: 0,  field: 'helpful_no'  },
}, {
    tableName:   'kb_articles',
    underscored: true,
    paranoid:    true,
    timestamps:  true,
});

module.exports = KbArticle;
