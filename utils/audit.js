// ============================================================================
// utils/audit.js — Helper de auditoría reutilizable
//
// Uso en cualquier ruta:
//   const { logAudit } = require('../utils/audit');
//   await logAudit(req, 'create_equipment', 'equipment', equipment.id, { nombre });
// ============================================================================

const { AuditLog } = require('../src/models');
const logger = require('./logger');

/**
 * Registra una acción en el log de auditoría.
 * No lanza excepciones — fallo silencioso para no interrumpir la request.
 *
 * @param {object}  req        - Express request (para extraer user e ip)
 * @param {string}  accion     - Nombre de la acción (ej: 'login', 'create_equipment')
 * @param {string}  [recurso]  - Entidad afectada (ej: 'equipment', 'users')
 * @param {*}       [recursoId]- ID del registro afectado
 * @param {object}  [detalles] - Datos adicionales (se serializa a JSON)
 */
async function logAudit(req, accion, recurso = null, recursoId = null, detalles = null) {
    try {
        await AuditLog.create({
            userId:    req.user?.id    ?? null,
            accion,
            recurso,
            recursoId: recursoId ? String(recursoId) : null,
            detalles,
            ip:        req.ip || req.headers['x-forwarded-for'] || null,
            userAgent: req.headers['user-agent'] || null,
        });
    } catch (error) {
        // No propagar — el log nunca debe romper la operación principal
        logger.error(`Error registrando auditoría [${accion}]:`, error.message);
    }
}

/**
 * Middleware factory — registra la acción automáticamente después de responder.
 * Útil para rutas donde no quieres modificar el handler.
 *
 * Uso:
 *   router.post('/equipment', authenticateToken, auditMiddleware('create_equipment', 'equipment'), handler);
 */
function auditMiddleware(accion, recurso = null) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            // Registrar solo si la respuesta fue exitosa
            if (res.statusCode < 400) {
                const recursoId = body?.data?.id ?? body?.id ?? null;
                logAudit(req, accion, recurso, recursoId, null);
            }
            return originalJson(body);
        };
        next();
    };
}

module.exports = { logAudit, auditMiddleware };
