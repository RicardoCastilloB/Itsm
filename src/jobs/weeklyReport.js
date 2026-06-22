// ============================================================================
// src/jobs/weeklyReport.js — Reporte semanal (lunes 8am) a supervisores/admins
// Usa dbQuery directo (equipmentPool) — sin Sequelize
// ============================================================================

const cron    = require('node-cron');
const nodemailer = require('nodemailer');
const { equipmentPool, executeQuery } = require('../../config/database');
const logger  = require('../../utils/logger');

async function dbQuery(sql, params = []) {
    return executeQuery(equipmentPool, sql, params);
}

function createTransport() {
    return nodemailer.createTransport({
        host:   process.env.SMTP_HOST || 'smtp.office365.com',
        port:   parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

function buildHtml(sup, s, topCats, agentLoad, weekStr) {
    const slaBar = s.sla_pct != null
        ? `<div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin:6px 0;">
             <div style="height:100%;width:${s.sla_pct}%;background:${s.sla_pct>=80?'#10b981':'#f59e0b'};border-radius:4px;"></div>
           </div>` : '';

    const catRows = topCats.map((c, i) =>
        `<tr style="background:${i%2===0?'#f8fafc':'#fff'}">
           <td style="padding:6px 12px;">${i+1}. ${c.nombre || '—'}</td>
           <td style="padding:6px 12px;text-align:right;font-weight:700;">${c.cnt}</td>
         </tr>`
    ).join('');

    const agentRows = agentLoad.map(a =>
        `<tr>
           <td style="padding:6px 12px;">${a.nombre || '—'}</td>
           <td style="padding:6px 12px;text-align:center;">${a.total}</td>
           <td style="padding:6px 12px;text-align:center;color:#10b981;font-weight:700;">${a.resueltos}</td>
         </tr>`
    ).join('');

    return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(9,30,66,.15);">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#172B4D,#0052CC);padding:24px 28px;">
    <div style="font-size:22px;font-weight:800;color:#fff;">📊 Reporte Semanal ITSM</div>
    <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px;">${weekStr}</div>
  </div>
  <!-- Saludo -->
  <div style="padding:20px 28px 0;">
    <p style="color:#172B4D;font-size:14px;">Hola <strong>${sup.full_name||sup.username||'Supervisor'}</strong>, aquí tienes el resumen de la semana:</p>
  </div>
  <!-- Stats -->
  <div style="padding:16px 28px;display:flex;gap:12px;flex-wrap:wrap;">
    ${[
      {label:'Total creados', val: s.total||0, color:'#0052CC'},
      {label:'Resueltos',     val: s.resueltos||0, color:'#10b981'},
      {label:'SLA vencidos',  val: s.vencidos||0, color:'#ef4444'},
      {label:'P1 Críticos',   val: s.p1||0, color:'#dc2626'},
    ].map(st => `<div style="flex:1;min-width:110px;background:#f8fafc;border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:${st.color};">${st.val}</div>
        <div style="font-size:11px;color:#5E6C84;margin-top:2px;">${st.label}</div>
      </div>`).join('')}
  </div>
  <!-- SLA -->
  <div style="padding:0 28px 16px;">
    <div style="font-size:12px;color:#5E6C84;">Cumplimiento SLA: <strong style="color:#172B4D;">${s.sla_pct!=null?s.sla_pct+'%':'—'}</strong></div>
    ${slaBar}
    <div style="font-size:12px;color:#5E6C84;margin-top:4px;">Tiempo promedio de resolución: <strong style="color:#172B4D;">${s.avg_h!=null?s.avg_h+' horas':'—'}</strong></div>
  </div>
  ${topCats.length ? `
  <!-- Top categorías -->
  <div style="padding:0 28px 16px;">
    <div style="font-size:14px;font-weight:700;color:#172B4D;margin-bottom:8px;">📁 Top Categorías</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#172B4D;color:#fff;">
        <th style="padding:6px 12px;text-align:left;">Categoría</th>
        <th style="padding:6px 12px;text-align:right;">Tickets</th>
      </tr></thead>
      <tbody>${catRows}</tbody>
    </table>
  </div>` : ''}
  ${agentLoad.length ? `
  <!-- Carga por agente -->
  <div style="padding:0 28px 20px;">
    <div style="font-size:14px;font-weight:700;color:#172B4D;margin-bottom:8px;">👥 Carga por Agente</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#172B4D;color:#fff;">
        <th style="padding:6px 12px;text-align:left;">Agente</th>
        <th style="padding:6px 12px;text-align:center;">Total</th>
        <th style="padding:6px 12px;text-align:center;">Resueltos</th>
      </tr></thead>
      <tbody>${agentRows}</tbody>
    </table>
  </div>` : ''}
  <!-- Footer -->
  <div style="background:#f4f5f7;padding:14px 28px;font-size:11px;color:#5E6C84;text-align:center;">
    Generado automáticamente por el sistema ITSM · ${new Date().toLocaleString('es-PE')}
  </div>
</div>
</body></html>`;
}

async function runWeeklyReport() {
    logger.info('[weeklyReport] Generando reporte semanal...');
    try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 19).replace('T', ' ');
        const weekStr = `Semana del ${new Date(Date.now() - 7*24*60*60*1000).toLocaleDateString('es-PE',{day:'numeric',month:'long'})} al ${new Date().toLocaleDateString('es-PE',{day:'numeric',month:'long',year:'numeric'})}`;

        const [stats] = await dbQuery(`
            SELECT
              COUNT(*)                                                                   AS total,
              SUM(CASE WHEN status IN ('resuelto','cerrado','closed','resolved') THEN 1 ELSE 0 END)  AS resueltos,
              SUM(CASE WHEN sla_status = 'vencido' THEN 1 ELSE 0 END)                   AS vencidos,
              SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END)                          AS p1,
              SUM(CASE WHEN priority = 'P2' THEN 1 ELSE 0 END)                          AS p2,
              ROUND(AVG(CASE WHEN resolved_at IS NOT NULL
                THEN TIMESTAMPDIFF(MINUTE, created_at, resolved_at) / 60.0 END), 1)    AS avg_h,
              ROUND(
                SUM(CASE WHEN sla_status = 'ok' AND status IN ('resuelto','cerrado') THEN 1 ELSE 0 END) /
                NULLIF(SUM(CASE WHEN status IN ('resuelto','cerrado') THEN 1 ELSE 0 END), 0) * 100
              , 1)                                                                       AS sla_pct
            FROM jira_tickets
            WHERE created_at >= ?
        `, [weekAgo]);

        const topCats = await dbQuery(`
            SELECT COALESCE(category, tipologia, 'Sin categoría') AS nombre, COUNT(*) AS cnt
            FROM jira_tickets
            WHERE created_at >= ?
            GROUP BY nombre ORDER BY cnt DESC LIMIT 5
        `, [weekAgo]);

        const agentLoad = await dbQuery(`
            SELECT u.full_name AS nombre, COUNT(t.ticket_key) AS total,
              SUM(CASE WHEN t.status IN ('resuelto','cerrado') THEN 1 ELSE 0 END) AS resueltos
            FROM jira_tickets t
            JOIN users u ON u.id = t.assigned_user_id
            WHERE t.created_at >= ?
            GROUP BY u.id, u.full_name ORDER BY total DESC LIMIT 10
        `, [weekAgo]);

        // Destinatarios: admins y supervisores
        const supervisors = await dbQuery(
            `SELECT id, full_name, username, email FROM users WHERE role IN ('administrador','supervisor','admin') AND is_active = 1 AND email IS NOT NULL`
        );

        if (!supervisors.length) {
            logger.warn('[weeklyReport] No hay supervisores activos con email');
            return;
        }

        const transporter = createTransport();
        for (const sup of supervisors) {
            try {
                await transporter.sendMail({
                    from:    `"${process.env.MAIL_FROM_NAME||'ITSM Sistema'}" <${process.env.SMTP_USER}>`,
                    to:      sup.email,
                    subject: `📊 Reporte Semanal ITSM — ${new Date().toLocaleDateString('es-PE',{day:'numeric',month:'long',year:'numeric'})}`,
                    html:    buildHtml(sup, stats||{}, topCats, agentLoad, weekStr),
                });
                logger.info(`[weeklyReport] Enviado a ${sup.email}`);
            } catch(emailErr) {
                logger.error(`[weeklyReport] Error enviando a ${sup.email}:`, emailErr.message);
            }
        }
        logger.info(`[weeklyReport] Completado — ${supervisors.length} destinatarios`);
    } catch(err) {
        logger.error('[weeklyReport] Error:', err.message);
    }
}

// Lunes a las 8am hora Lima
cron.schedule('0 8 * * 1', runWeeklyReport, { timezone: 'America/Lima' });

logger.info('[weeklyReport] Job registrado — lunes 08:00 Lima');

module.exports = { runWeeklyReport }; // exportar para testing manual
