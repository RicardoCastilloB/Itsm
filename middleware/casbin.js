// ============================================================================
// middleware/casbin.js — RBAC con Casbin
//
// Uso en rutas:
//   const { authorize } = require('./middleware/casbin');
//   router.post('/equipment', authenticateToken, authorize('equipment', 'create'), handler);
// ============================================================================

const { newEnforcer } = require('casbin');
const path   = require('path');
const logger = require('../utils/logger');

const MODEL_PATH  = path.join(__dirname, '../src/config/rbac_model.conf');
const POLICY_PATH = path.join(__dirname, '../src/config/rbac_policy.csv');

let enforcer = null;

// ============================================================================
// Inicializar enforcer (llamar una vez al arrancar el servidor)
// ============================================================================
async function initCasbin() {
    try {
        enforcer = await newEnforcer(MODEL_PATH, POLICY_PATH);
        logger.info('✅ Casbin RBAC inicializado');
        return enforcer;
    } catch (error) {
        logger.error('❌ Error al inicializar Casbin:', error);
        throw error;
    }
}

// ============================================================================
// Middleware de autorización
// Requiere que authenticateToken ya haya poblado req.user
// ============================================================================
function authorize(recurso, accion) {
    return async (req, res, next) => {
        try {
            if (!enforcer) {
                await initCasbin();
            }

            const rol = req.user?.role || req.user?.rol;

            if (!rol) {
                return res.status(401).json({
                    success: false,
                    error:   'No autenticado',
                });
            }

            const permitido = await enforcer.enforce(rol, recurso, accion);

            if (!permitido) {
                logger.warn(`Acceso denegado: rol=${rol} recurso=${recurso} accion=${accion}`);
                return res.status(403).json({
                    success: false,
                    error:   `Sin permiso para realizar "${accion}" en "${recurso}"`,
                    rol,
                });
            }

            next();

        } catch (error) {
            logger.error('Error en middleware Casbin:', error);
            return res.status(500).json({ success: false, error: 'Error de autorización' });
        }
    };
}

// ============================================================================
// Verificar permiso sin middleware (útil en lógica de negocio)
// ============================================================================
async function puede(rol, recurso, accion) {
    if (!enforcer) await initCasbin();
    return enforcer.enforce(rol, recurso, accion);
}

module.exports = { initCasbin, authorize, puede };
