// src/queues/emailWorker.js — Worker que procesa la cola de emails
const { emailQueue } = require('./index');
const nodemailer    = require('nodemailer');
const path          = require('path');
const ejs           = require('ejs');
const logger        = require('../../utils/logger');

// Transporte SMTP (configurable por .env)
const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.ethereal.email',
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
    },
});

emailQueue.process(async (job) => {
    const { to, subject, template, vars } = job.data;

    const templatePath = path.join(__dirname, '../../views/emails', `${template}.ejs`);
    const html = await ejs.renderFile(templatePath, vars || {});

    await transporter.sendMail({
        from:    process.env.SMTP_FROM || '"Soporte TI" <soporte@empresa.com>',
        to,
        subject,
        html,
    });

    logger.info(`📧 Email enviado → ${to} [${template}]`);
    return { sent: true, to };
});

emailQueue.on('failed', (job, err) => {
    logger.error(`❌ Email fallido [${job.data?.template}] → ${job.data?.to}: ${err.message}`);
});

logger.info('✅ Email worker activo');
module.exports = emailQueue;
