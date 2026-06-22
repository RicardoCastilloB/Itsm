'use strict';

const express = require('express');
const { emailQueue, slaQueue, reportsQueue } = require('../src/queues/index');

// Dashboard de colas (reemplaza @bull-board) — endpoint simple con conteos por estado
module.exports = function setupQueueDashboard(app) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            const [email, sla, reports] = await Promise.all([
                emailQueue.getJobCounts(),
                slaQueue.getJobCounts(),
                reportsQueue.getJobCounts(),
            ]);
            res.json({ queues: { email, sla, reports }, ts: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.use('/admin/queues', router);
};
