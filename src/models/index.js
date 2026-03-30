const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
    process.env.EQUIPMENT_DATABASE,
    process.env.EQUIPMENT_USER,
    process.env.EQUIPMENT_PASSWORD,
    {
        host:    process.env.EQUIPMENT_HOST || 'localhost',
        port:    process.env.EQUIPMENT_PORT || 3306,
        dialect: 'mysql',
        pool: {
            max:     10,
            min:     2,
            acquire: 30000,
            idle:    10000,
        },
        logging: process.env.NODE_ENV === 'development'
            ? (msg) => console.log(`[SQL] ${msg}`)
            : false,
        define: {
            timestamps:  true,
            underscored: true,
            paranoid:    true,
        },
    }
);

// Modelos
const User       = require('./User')(sequelize);
const Role       = require('./Role')(sequelize);
const Permission = require('./Permission')(sequelize);
const AuditLog   = require('./AuditLog')(sequelize);

// Relaciones User ↔ Role
//User.belongsToMany(Role,       { through: 'user_roles' });
//Role.belongsToMany(User,       { through: 'user_roles' });

// Relaciones Role ↔ Permission
Role.belongsToMany(Permission, { through: 'role_permissions' });
Permission.belongsToMany(Role, { through: 'role_permissions' });

// Relación AuditLog → User
// AuditLog.belongsTo(User, { foreignKey: 'usuario_id' }); // pendiente migración UUID

module.exports = { sequelize, Sequelize, User, Role, Permission, AuditLog };