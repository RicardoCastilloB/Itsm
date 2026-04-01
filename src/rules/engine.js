// ============================================================================
// src/rules/engine.js — Motor de reglas de negocio (json-rules-engine)
// Item 117-122: evaluación, recarga desde BD, acciones configurables
// ============================================================================

const { Engine } = require('json-rules-engine');
const logger = require('../../utils/logger');
const { BusinessRule } = require('../models');
const { enqueueEmail } = require('../queues/index');

// ── Cache de reglas cargadas ─────────────────────────────────────────────────
let _engine = null;
let _loadedAt = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

async function getEngine() {
    const now = Date.now();
    if (_engine && _loadedAt && (now - _loadedAt) < CACHE_TTL_MS) return _engine;
    return reloadEngine();
}

async function reloadEngine() {
    const rules = await BusinessRule.findAll({ where: { isActive: true }, order: [['priority', 'ASC']] });
    const engine = new Engine([], { allowUndefinedFacts: true });

    // Convertir cada regla de BD al formato json-rules-engine
    rules.forEach(rule => {
        engine.addRule({
            name: `rule_${rule.id}_${rule.runOn}`,
            conditions: rule.conditions,
            event: {
                type: rule.runOn,
                params: { ruleId: rule.id, ruleName: rule.name, actions: rule.actions },
            },
            priority: 100 - rule.priority, // json-rules-engine: higher = evaluated first
        });
    });

    _engine = engine;
    _loadedAt = Date.now();
    logger.info(`Rules engine: ${rules.length} reglas cargadas`);
    return engine;
}

// ── Ejecutar reglas contra un contexto de ticket ─────────────────────────────
// context = { ticketId, titulo, priority, status, categoryId, categoryName,
//             assignedTo, createdBy, creatorTag, tipo, ageMinutes }
async function evalTicket(context, runOn = 'ticket_created') {
    const engine = await getEngine();

    const facts = { ...context };
    const { events } = await engine.run(facts);

    // Filtrar eventos del evento correcto
    const matched = events.filter(e => e.type === runOn);
    if (!matched.length) return [];

    const results = [];
    for (const ev of matched) {
        const { ruleId, ruleName, actions } = ev.params;
        logger.info(`Regla "${ruleName}" (id:${ruleId}) disparada para ticket ${context.ticketId}`);
        const applied = await applyActions(actions, context);
        results.push({ ruleId, ruleName, actions: applied });
    }
    return results;
}

// ── Aplicar acciones de una regla ────────────────────────────────────────────
async function applyActions(actions, context) {
    const applied = [];
    const { Ticket, TicketComment, User } = require('../models');

    for (const action of actions) {
        try {
            switch (action.type) {

                case 'notify_role': {
                    // Notificar a todos los usuarios con el rol indicado
                    const { role, message } = action.params;
                    const users = await User.findAll({ where: { rol: role, activo: true } });
                    for (const u of users) {
                        await enqueueEmail({
                            to:       u.email,
                            subject:  `[Alerta] ${message}`,
                            template: 'sla-riesgo',
                            vars:     { nombre: u.nombre, ticketId: context.ticketId, mensaje: message },
                        });
                    }
                    applied.push({ type: action.type, status: 'ok', count: users.length });
                    break;
                }

                case 'set_sla_status': {
                    const { status } = action.params;
                    await Ticket.update({ slaStatus: status }, { where: { id: context.ticketId } });
                    applied.push({ type: action.type, status: 'ok' });
                    break;
                }

                case 'upgrade_priority': {
                    const levels = action.params.levels || 1;
                    const order  = ['P4', 'P3', 'P2', 'P1'];
                    const cur    = order.indexOf(context.priority);
                    const next   = order[Math.min(cur + levels, order.length - 1)];
                    if (next !== context.priority) {
                        await Ticket.update({ priority: next }, { where: { id: context.ticketId } });
                    }
                    applied.push({ type: action.type, status: 'ok', from: context.priority, to: next });
                    break;
                }

                case 'assign_group': {
                    // Busca un agente disponible con el tag del grupo (simplificado)
                    const { group } = action.params;
                    logger.info(`Asignando ticket ${context.ticketId} al grupo "${group}"`);
                    applied.push({ type: action.type, status: 'ok', group });
                    break;
                }

                case 'add_comment': {
                    const { text } = action.params;
                    await TicketComment.create({
                        ticketId:  context.ticketId,
                        userId:    null,
                        contenido: `[Regla automática] ${text}`,
                        tipo:      'sistema',
                    });
                    applied.push({ type: action.type, status: 'ok' });
                    break;
                }

                case 'add_tag': {
                    const ticket = await Ticket.findByPk(context.ticketId);
                    if (ticket) {
                        const meta = ticket.metadata || {};
                        meta.tags = [...new Set([...(meta.tags || []), action.params.tag])];
                        await ticket.update({ metadata: meta });
                    }
                    applied.push({ type: action.type, status: 'ok' });
                    break;
                }

                default:
                    logger.warn(`Acción desconocida: ${action.type}`);
                    applied.push({ type: action.type, status: 'unknown' });
            }
        } catch (err) {
            logger.error(`Error aplicando acción ${action.type}:`, err.message);
            applied.push({ type: action.type, status: 'error', error: err.message });
        }
    }
    return applied;
}

// Invalidar cache manualmente (llamar después de CRUD de reglas)
function invalidateCache() {
    _engine   = null;
    _loadedAt = null;
}

module.exports = { evalTicket, reloadEngine, invalidateCache };
