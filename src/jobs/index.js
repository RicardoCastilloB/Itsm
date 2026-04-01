// ============================================================================
// src/jobs/index.js — Registro de todos los jobs node-cron
// Requieren este archivo en server.js: require('./src/jobs/index')
// ============================================================================

const logger = require('../../utils/logger');

function startJobs() {
    logger.info('[jobs] Iniciando jobs programados...');
    require('./slaMonitor');    // cada 5 min
    require('./escalation');   // cada hora
    require('./dailyStats');   // medianoche
    require('./weeklyReport'); // lunes 8am
    require('./archiveTickets'); // 1ro del mes 2am
    logger.info('[jobs] Todos los jobs registrados ✓');
}

module.exports = { startJobs };
