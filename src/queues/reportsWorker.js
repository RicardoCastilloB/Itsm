// src/queues/reportsWorker.js — Worker generación de reportes PDF/CSV/Excel
const { reportsQueue }   = require('./index');
const { Parser }         = require('json2csv');
const ExcelJS            = require('exceljs');
const PDFDocument        = require('pdfkit');
const sequelize          = require('../config/database');
const { QueryTypes }     = require('sequelize');
const path               = require('path');
const fs                 = require('fs');
const logger             = require('../../utils/logger');

const REPORTS_DIR = path.join(__dirname, '../../public/reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

reportsQueue.process(async (job) => {
    const { type, filters, userId, reportId } = job.data;

    // Obtener datos según filtros
    let sql = `
        SELECT t.ticket_number, t.title, t.status, t.priority, t.sla_status,
               t.created_at, t.resolved_at,
               TIMESTAMPDIFF(HOUR, t.created_at, IFNULL(t.resolved_at, NOW())) AS hours_open,
               c.name AS category
        FROM tickets t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.deleted_at IS NULL
    `;
    const replacements = [];
    if (filters?.startDate) { sql += ' AND t.created_at >= ?'; replacements.push(filters.startDate); }
    if (filters?.endDate)   { sql += ' AND t.created_at <= ?'; replacements.push(filters.endDate + ' 23:59:59'); }
    if (filters?.status)    { sql += ' AND t.status = ?';      replacements.push(filters.status); }
    sql += ' ORDER BY t.created_at DESC LIMIT 5000';

    const rows = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
    const filename = `reporte_${reportId || Date.now()}`;

    if (type === 'csv') {
        const parser = new Parser();
        const csv    = parser.parse(rows);
        const file   = `${filename}.csv`;
        fs.writeFileSync(path.join(REPORTS_DIR, file), csv, 'utf8');
        return { file, url: `/reports/${file}`, rows: rows.length };
    }

    if (type === 'excel') {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Tickets');
        ws.columns = [
            { header: 'N° Ticket',  key: 'ticket_number', width: 14 },
            { header: 'Título',     key: 'title',         width: 40 },
            { header: 'Estado',     key: 'status',        width: 14 },
            { header: 'Prioridad',  key: 'priority',      width: 12 },
            { header: 'SLA',        key: 'sla_status',    width: 12 },
            { header: 'Categoría',  key: 'category',      width: 20 },
            { header: 'Creado',     key: 'created_at',    width: 18 },
            { header: 'Resuelto',   key: 'resolved_at',   width: 18 },
            { header: 'Horas',      key: 'hours_open',    width: 10 },
        ];
        ws.getRow(1).font = { bold: true };
        ws.addRows(rows);
        const file = `${filename}.xlsx`;
        await wb.xlsx.writeFile(path.join(REPORTS_DIR, file));
        return { file, url: `/reports/${file}`, rows: rows.length };
    }

    if (type === 'pdf') {
        const file = `${filename}.pdf`;
        const doc  = new PDFDocument({ margin: 40, size: 'A4' });
        const out  = fs.createWriteStream(path.join(REPORTS_DIR, file));
        doc.pipe(out);

        doc.fontSize(16).text('Reporte de Tickets ITSM', { align: 'center' });
        doc.fontSize(10).text(`Generado: ${new Date().toLocaleString('es')}`, { align: 'center' });
        doc.moveDown();

        // Tabla simple
        const cols = ['ticket_number','title','status','priority','sla_status'];
        const widths = [70, 180, 70, 60, 60];
        let y = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        let x = 40;
        ['Ticket','Título','Estado','Prioridad','SLA'].forEach((h, i) => {
            doc.text(h, x, y, { width: widths[i] }); x += widths[i];
        });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(8);
        rows.slice(0, 200).forEach(row => {
            y = doc.y;
            x = 40;
            if (y > 750) { doc.addPage(); y = 40; }
            cols.forEach((col, i) => {
                doc.text(String(row[col] || ''), x, y, { width: widths[i] }); x += widths[i];
            });
            doc.moveDown(0.3);
        });
        doc.end();
        await new Promise(r => out.on('finish', r));
        return { file, url: `/reports/${file}`, rows: rows.length };
    }

    throw new Error(`Tipo de reporte desconocido: ${type}`);
});

reportsQueue.on('failed', (job, err) => {
    logger.error(`❌ Reports worker fallido [${job.data?.type}]: ${err.message}`);
});

logger.info('✅ Reports worker activo');
module.exports = reportsQueue;
