const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReportJob = sequelize.define('ReportJob', {
    id:          { type: DataTypes.CHAR(36),   primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId:      { type: DataTypes.CHAR(36),   allowNull: false, field: 'user_id' },
    type:        { type: DataTypes.ENUM('csv','excel','pdf'), allowNull: false },
    status:      { type: DataTypes.ENUM('pending','processing','done','failed'), defaultValue: 'pending' },
    filters:     { type: DataTypes.JSON,       allowNull: true  },
    fileUrl:     { type: DataTypes.STRING(500),allowNull: true,  field: 'file_url' },
    rowCount:    { type: DataTypes.INTEGER,    allowNull: true,  field: 'row_count' },
    errorMsg:    { type: DataTypes.TEXT,       allowNull: true,  field: 'error_msg' },
    requestedAt: { type: DataTypes.DATE,       defaultValue: DataTypes.NOW, field: 'requested_at' },
    completedAt: { type: DataTypes.DATE,       allowNull: true,  field: 'completed_at' },
}, {
    tableName:   'report_jobs',
    underscored: true,
    paranoid:    false,
    timestamps:  false,
});

module.exports = ReportJob;
