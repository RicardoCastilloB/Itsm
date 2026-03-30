// ============================================================================
// routes/reports.js
// Generación de reportes al vuelo + envío de correo
//
// INSTALACIÓN:
//   npm install exceljs pdfkit nodemailer multer
//
// REGISTRO EN app.js (añadir junto a los demás routers):
//   const reportsRouter = require('./routes/reports');
//   app.use('/api/reports', reportsRouter);   // GET /api/reports/:id → descarga
//   app.use('/api/mailer',  reportsRouter);   // POST /api/mailer/send → envío
//
// RUTA DE VISTA en routes/views.js:
//   router.get('/send-reports', authenticateToken, (req, res) =>
//     res.render('send-reports', { title: 'Envío de Reportes', user: req.user })
//   );
//
// VARIABLES .env necesarias:
//   SMTP_HOST=smtp.office365.com   (o smtp.gmail.com)
//   SMTP_PORT=587
//   SMTP_SECURE=false
//   SMTP_USER=reportes@tuempresa.com
//   SMTP_PASS=tu_password_o_app_password
//   MAIL_FROM_NAME=EquipManager    (nombre que aparece como remitente)
// ============================================================================

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { executeQuery: execQuery, equipmentPool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Librerías de generación ─────────────────────────────────────────────────
let ExcelJS, PDFDocument, nodemailer;
try { ExcelJS     = require('exceljs');    } catch(e) { console.warn('⚠️  npm install exceljs');    }
try { PDFDocument = require('pdfkit');     } catch(e) { console.warn('⚠️  npm install pdfkit');     }
try { nodemailer  = require('nodemailer'); } catch(e) { console.warn('⚠️  npm install nodemailer'); }

// ── Multer — archivos adjuntos en memoria ────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 25 * 1024 * 1024, files: 20 }
});

// ── Helper: PDFDocument → Buffer ─────────────────────────────────────────────
function pdfToBuffer(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data',  c  => chunks.push(c));
        doc.on('end',   () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

// ── Helper: cabecera de tabla en Excel ───────────────────────────────────────
function styleExcelHeader(ws, fillColor = 'FF3B82F6') {
    ws.getRow(1).eachCell(cell => {
        cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        cell.font   = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(1).height = 22;
}

// ── Helper: cabecera de PDF ───────────────────────────────────────────────────
function pdfHeader(doc, title) {
    doc.fontSize(17).font('Helvetica-Bold')
       .fillColor('#1e293b').text(title, { align: 'center' });
    doc.fontSize(9).font('Helvetica')
       .fillColor('#64748b')
       .text(`Generado: ${new Date().toLocaleString('es-PE')} · Sistema EquipManager`, { align: 'center' });
    doc.moveDown(1.5);
    doc.fillColor('#1e293b');
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERADORES
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1) Empleados → PDF ────────────────────────────────────────────────────────
async function generateEmpleadosPDF() {
    const rows = await execQuery(equipmentPool, `
        SELECT full_name, cip, email, position_name, is_active, updated_at
        FROM employees
        ORDER BY is_active DESC, full_name
    `);

    const doc = new PDFDocument({ margin: 40, size: 'A4', compress: true });
    pdfHeader(doc, 'Reporte de Empleados');

    rows.forEach((r, i) => {
        const status = r.is_active ? 'Activo' : 'Baja';
        doc.fontSize(10).font('Helvetica-Bold')
           .text(`${i + 1}. ${r.full_name}`, { continued: true })
           .font('Helvetica')
           .text(`  ·  CIP: ${r.cip || '—'}  ·  ${r.email || '—'}  ·  ${r.position_name || '—'}  ·  ${status}`);
        doc.moveDown(0.2);
    });

    doc.fontSize(9).fillColor('#64748b').moveDown()
       .text(`Total registros: ${rows.length}`, { align: 'right' });

    return {
        buffer:      await pdfToBuffer(doc),
        filename:    `empleados_${todayStr()}.pdf`,
        contentType: 'application/pdf',
    };
}

// ── 2) Asignaciones Activas → Excel ──────────────────────────────────────────
async function generateAsignacionesExcel() {
    const rows = await execQuery(equipmentPool, `
        SELECT a.id,
               e.full_name  AS empleado,
               e.cip,
               eq.device_code AS equipo,
               eq.model        AS modelo,
               DATE_FORMAT(a.assignment_date,'%d/%m/%Y') AS fecha,
               d.department_name AS departamento,
               l.location_name   AS ubicacion
        FROM assignments a
        LEFT JOIN employees   e  ON e.id  = a.employee_id
        LEFT JOIN equipment   eq ON eq.id = a.equipment_id
        LEFT JOIN departments d  ON d.id  = a.department_id
        LEFT JOIN locations   l  ON l.id  = a.location_id
        WHERE a.return_date IS NULL
          AND a.employee_id != 0
        ORDER BY a.assignment_date DESC
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'EquipManager';
    const ws = wb.addWorksheet('Asignaciones', { views: [{ state: 'frozen', ySplit: 1 }] });

    ws.columns = [
        { header: 'ID',           key: 'id',           width: 8  },
        { header: 'Empleado',     key: 'empleado',      width: 30 },
        { header: 'CIP',          key: 'cip',           width: 13 },
        { header: 'Equipo',       key: 'equipo',        width: 15 },
        { header: 'Modelo',       key: 'modelo',        width: 25 },
        { header: 'Fecha Asig.',  key: 'fecha',         width: 13 },
        { header: 'Departamento', key: 'departamento',  width: 22 },
        { header: 'Ubicación',    key: 'ubicacion',     width: 27 },
    ];
    styleExcelHeader(ws);
    rows.forEach(r => ws.addRow(r));

    // Zebra
    ws.eachRow((row, n) => {
        if (n > 1 && n % 2 === 0) {
            row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
        }
    });

    return {
        buffer:      await wb.xlsx.writeBuffer(),
        filename:    `asignaciones_${todayStr()}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
}

// ── 3) Cola de Impresión → PDF ────────────────────────────────────────────────
async function generatePrintQueuePDF() {
    const rows = await execQuery(equipmentPool, `
        SELECT id, email_from_name, file_original, file_type,
               copies, num_pages, priority, status, queued_at
        FROM print_queue
        WHERE status IN ('pendiente','imprimiendo')
        ORDER BY is_vip DESC,
                 CASE priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 ELSE 3 END,
                 queued_at ASC
        LIMIT 200
    `);

    const doc = new PDFDocument({ margin: 40, size: 'A4', compress: true });
    pdfHeader(doc, 'Cola de Impresión — Pendientes');

    if (!rows.length) {
        doc.fontSize(11).text('Sin documentos pendientes.', { align: 'center' });
    } else {
        rows.forEach((r, i) => {
            const pages = r.num_pages ? `${r.num_pages}p × ${r.copies}c` : `${r.copies} cop.`;
            doc.fontSize(10).font('Helvetica-Bold')
               .text(`#${r.id} ${r.file_original || '—'}`, { continued: true })
               .font('Helvetica')
               .text(`  ·  ${r.email_from_name || '—'}  ·  ${pages}  ·  ${r.priority}  ·  ${r.status}`);
            doc.moveDown(0.25);
        });
    }

    doc.fontSize(9).fillColor('#64748b').moveDown()
       .text(`Total en cola: ${rows.length}`, { align: 'right' });

    return {
        buffer:      await pdfToBuffer(doc),
        filename:    `cola_impresion_${todayStr()}.pdf`,
        contentType: 'application/pdf',
    };
}

// ── 4) KPIs del Mes → PDF ────────────────────────────────────────────────────
async function generateKpisPDF() {
    const [[emp], [asig], [cola], [equip]] = await Promise.all([
        execQuery(equipmentPool, 'SELECT COUNT(*) AS total, SUM(is_active) AS activos FROM employees'),
        execQuery(equipmentPool, `SELECT COUNT(*) AS total FROM assignments WHERE return_date IS NULL AND employee_id != 0`),
        execQuery(equipmentPool, `
            SELECT SUM(COALESCE(num_pages,1)*copies) AS hojas,
                   COUNT(*) AS docs
            FROM print_queue
            WHERE MONTH(queued_at)=MONTH(CURRENT_DATE) AND YEAR(queued_at)=YEAR(CURRENT_DATE)`),
        execQuery(equipmentPool, `
            SELECT
                SUM(status='Disponible')   AS disponibles,
                SUM(status='Asignado')     AS asignados,
                SUM(status='En Mantenimiento') AS mantenimiento,
                COUNT(*) AS total
            FROM equipment`),
    ]);

    const mes = new Date().toLocaleString('es-PE', { month: 'long', year: 'numeric' });
    const doc = new PDFDocument({ margin: 40, size: 'A4', compress: true });
    pdfHeader(doc, `KPIs — ${mes.charAt(0).toUpperCase() + mes.slice(1)}`);

    const kpis = [
        ['Empleados Totales',         emp.total        || 0],
        ['Empleados Activos',          emp.activos      || 0],
        ['Asignaciones Activas',       asig.total       || 0],
        ['Equipos Disponibles',        equip.disponibles || 0],
        ['Equipos Asignados',          equip.asignados  || 0],
        ['Equipos en Mantenimiento',   equip.mantenimiento || 0],
        ['Total Equipos',              equip.total      || 0],
        ['Hojas Impresas (mes actual)',cola.hojas       || 0],
        ['Docs Impresos (mes actual)', cola.docs        || 0],
    ];

    kpis.forEach(([k, v]) => {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e293b').text(`${k}:`, { continued: true, width: 250 })
           .font('Helvetica').fillColor('#3b82f6').text(`  ${Number(v).toLocaleString('es-PE')}`);
        doc.fillColor('#e2e8f0').moveTo(40, doc.y).lineTo(555, doc.y).lineWidth(0.5).stroke();
        doc.moveDown(0.4);
    });

    return {
        buffer:      await pdfToBuffer(doc),
        filename:    `kpis_${todayStr()}.pdf`,
        contentType: 'application/pdf',
    };
}

// ── 5) Inventario de Equipos → Excel ─────────────────────────────────────────
async function generateInventarioExcel() {
    const rows = await execQuery(equipmentPool, `
        SELECT eq.id,
               eq.device_code        AS codigo,
               eq.brand              AS marca,
               eq.model              AS modelo,
               eq.serial_number      AS serie,
               eq.equipment_type     AS tipo,
               eq.status             AS estado,
               DATE_FORMAT(eq.purchase_date,'%d/%m/%Y') AS fecha_compra,
               eq.purchase_price     AS precio,
               e.full_name           AS asignado_a,
               l.location_name       AS ubicacion
        FROM equipment eq
        LEFT JOIN assignments a  ON a.equipment_id = eq.id AND a.return_date IS NULL AND a.employee_id != 0
        LEFT JOIN employees   e  ON e.id = a.employee_id
        LEFT JOIN locations   l  ON l.id = eq.location_id
        ORDER BY eq.status, eq.brand, eq.model
    `);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'EquipManager';
    const ws = wb.addWorksheet('Inventario', { views: [{ state: 'frozen', ySplit: 1 }] });

    ws.columns = [
        { header: 'ID',           key: 'id',           width: 8  },
        { header: 'Código',       key: 'codigo',       width: 15 },
        { header: 'Marca',        key: 'marca',        width: 16 },
        { header: 'Modelo',       key: 'modelo',       width: 25 },
        { header: 'Serie',        key: 'serie',        width: 22 },
        { header: 'Tipo',         key: 'tipo',         width: 16 },
        { header: 'Estado',       key: 'estado',       width: 18 },
        { header: 'F. Compra',    key: 'fecha_compra', width: 13 },
        { header: 'Precio',       key: 'precio',       width: 13 },
        { header: 'Asignado a',   key: 'asignado_a',   width: 28 },
        { header: 'Ubicación',    key: 'ubicacion',    width: 27 },
    ];
    styleExcelHeader(ws, 'FF10B981');
    rows.forEach(r => ws.addRow(r));

    return {
        buffer:      await wb.xlsx.writeBuffer(),
        filename:    `inventario_${todayStr()}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
}

// ── 6) Mantenimientos → PDF ───────────────────────────────────────────────────
async function generateMantenimientoPDF() {
    // ⚠️  Ajusta el nombre de la tabla y columnas a tu esquema real.
    //     Si no tienes tabla 'maintenances', este endpoint devolverá 0 registros sin error.
    const rows = await execQuery(equipmentPool, `
        SELECT m.id, m.maintenance_date, m.type, m.description,
               eq.device_code, eq.model,
               e.full_name AS tecnico
        FROM maintenances m
        LEFT JOIN equipment eq ON eq.id = m.equipment_id
        LEFT JOIN employees  e  ON e.id  = m.technician_id
        ORDER BY m.maintenance_date DESC
        LIMIT 300
    `).catch(() => []);   // Si la tabla no existe aún, devuelve array vacío

    const doc = new PDFDocument({ margin: 40, size: 'A4', compress: true });
    pdfHeader(doc, 'Historial de Mantenimientos');

    if (!rows.length) {
        doc.fontSize(11).text('Sin registros de mantenimiento.', { align: 'center' });
    } else {
        rows.forEach(r => {
            const fecha = r.maintenance_date
                ? new Date(r.maintenance_date).toLocaleDateString('es-PE') : '—';
            doc.fontSize(10).font('Helvetica-Bold')
               .text(`#${r.id}  [${fecha}]  ${r.device_code || '—'} — ${r.model || '—'}`, { continued: true })
               .font('Helvetica')
               .text(`  ·  ${r.type || '—'}  ·  ${r.tecnico || '—'}`);
            if (r.description) {
                doc.fontSize(9).fillColor('#64748b').text(`   ${r.description}`).fillColor('#1e293b');
            }
            doc.moveDown(0.3);
        });
    }

    doc.fontSize(9).fillColor('#64748b').moveDown()
       .text(`Total registros: ${rows.length}`, { align: 'right' });

    return {
        buffer:      await pdfToBuffer(doc),
        filename:    `mantenimientos_${todayStr()}.pdf`,
        contentType: 'application/pdf',
    };
}

// ── Mapa id → generador ────────────────────────────────────────────────────────
const GENERATORS = {
    'empleados':      generateEmpleadosPDF,
    'asignaciones':   generateAsignacionesExcel,
    'print-queue':    generatePrintQueuePDF,
    'kpis':           generateKpisPDF,
    'inventario':     generateInventarioExcel,
    'mantenimiento':  generateMantenimientoPDF,
};

// ── Helper fecha ───────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split('T')[0];

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/reports/:id — genera y descarga el reporte
router.get('/:id', authenticateToken, async (req, res) => {
    const gen = GENERATORS[req.params.id];
    if (!gen) {
        return res.status(404).json({ success: false, error: `Reporte '${req.params.id}' no encontrado` });
    }

    try {
        const { buffer, filename, contentType } = await gen();
        res.setHeader('Content-Type',        contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length',      buffer.length);
        res.send(buffer);
        console.log(`📄 Reporte generado: ${filename} (${buffer.length} bytes)`);
    } catch (err) {
        console.error(`❌ Error generando reporte '${req.params.id}':`, err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/mailer/send — recibe FormData y envía el correo
router.post('/send', authenticateToken, upload.array('files', 20), async (req, res) => {
    try {
        if (!nodemailer) throw new Error('nodemailer no instalado: npm install nodemailer');

        const to      = JSON.parse(req.body.to  || '[]');
        const cc      = JSON.parse(req.body.cc  || '[]');
        const bcc     = JSON.parse(req.body.bcc || '[]');
        const subject = (req.body.subject || '').trim();
        const body    = (req.body.body    || '').trim();

        if (!to.length)  throw new Error('Se requiere al menos un destinatario');
        if (!subject)    throw new Error('El asunto no puede estar vacío');

        const attachments = (req.files || []).map(f => ({
            filename:    f.originalname,
            content:     f.buffer,
            contentType: f.mimetype,
        }));

        const transporter = nodemailer.createTransport({
            host:   process.env.SMTP_HOST   || 'smtp.office365.com',
            port:   parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        // Verificar conexión en desarrollo
        if (process.env.NODE_ENV === 'development') {
            await transporter.verify().catch(e => console.warn('⚠️  SMTP verify:', e.message));
        }

        const info = await transporter.sendMail({
            from:        `"${process.env.MAIL_FROM_NAME || 'EquipManager'}" <${process.env.SMTP_USER}>`,
            to:          to.join(', '),
            cc:          cc.length  ? cc.join(', ')  : undefined,
            bcc:         bcc.length ? bcc.join(', ') : undefined,
            subject,
            text:        body,
            html:        `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${body.replace(/</g,'&lt;')}</div>`,
            attachments,
        });

        console.log(`📧 Correo enviado → ${to.join(', ')} | Asunto: ${subject} | Adjuntos: ${attachments.length} | msgId: ${info.messageId}`);

        res.json({
            success:     true,
            message:     'Correo enviado correctamente',
            recipients:  to.length,
            attachments: attachments.length,
            messageId:   info.messageId,
        });

    } catch (err) {
        console.error('❌ Error enviando correo:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
