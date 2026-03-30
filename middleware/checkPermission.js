const { PERMISSIONS } = require('./permissions');

/**
 * Middleware para validar si el usuario tiene permiso para una acción
 * @param {string} resource - Recurso (ej: 'equipment', 'assignments')
 * @param {string} action - Acción (ej: 'read', 'create', 'update', 'delete')
 */
const checkPermission = (resource, action) => {
  return (req, res, next) => {
    const userRole = req.user?.role;
    
    if (!userRole) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const permissions = PERMISSIONS[userRole]?.[resource] || [];
    const hasPermission = permissions.includes(action);

    if (!hasPermission) {
      return res.status(403).json({ 
        success: false, 
        error: `No tienes permiso para ${action} ${resource}`,
        userRole,
        required: `${action}:${resource}`
      });
    }

    next();
  };
};

module.exports = checkPermission;