'use strict';

// Colas MySQL — reemplaza Bull/Redis
const MysqlQueue = require('./MysqlQueue');

const emailQueue   = new MysqlQueue('email');
const slaQueue     = new MysqlQueue('sla');
const reportsQueue = new MysqlQueue('reports');

function enqueueEmail(data) {
    return emailQueue.add(data, { attempts: 3 });
}

function enqueueSla(ticketId = null) {
    return slaQueue.add({ ticketId }, { attempts: 5 });
}

function enqueueReport(data) {
    return reportsQueue.add(data, { attempts: 3 });
}

module.exports = { emailQueue, slaQueue, reportsQueue, enqueueEmail, enqueueSla, enqueueReport };
