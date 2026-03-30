// ============================================================
// routes/print-queue.js
// Cola de impresión — código de seguridad por correo
// Auto-eliminación 24h · Eliminar del buzón · Sin SharePoint
// ============================================================
const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const { executeQuery: execQuery, equipmentPool } = require('../config/database');

let msal, fetch, pdfParse;
try {
    msal  = require('@azure/msal-node');
    fetch = (...a) => import('node-fetch').then(m => m.default(...a));
} catch (e) { console.warn('Falta: npm install @azure/msal-node node-fetch'); }
try {
    pdfParse = require('pdf-parse');
} catch(e) { console.warn('Instala pdf-parse: npm install pdf-parse'); }

function CFG() {
    return {
        clientId:     process.env.MS_CLIENT_ID,
        tenantId:     process.env.MS_TENANT_ID,
        clientSecret: process.env.MS_CLIENT_SECRET,
        mailbox:      process.env.MS_USER_EMAIL,
    };
}

// ── Directorio local ──────────────────────────────────────
const ATTACH_DIR = path.join(__dirname, '..', 'uploads', 'print-queue');
if (!fs.existsSync(ATTACH_DIR)) fs.mkdirSync(ATTACH_DIR, { recursive: true });

const PRINTABLE_EXTS = new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.png','.jpg','.jpeg','.tiff','.bmp','.txt']);

// ── Generar código de seguridad aleatorio (4-6 dígitos) ───
function generateCode() {
    const digits = 4 + Math.floor(Math.random() * 3); // 4, 5 o 6
    let code = '';
    for (let i = 0; i < digits; i++) code += Math.floor(Math.random() * 10);
    return code;
}

// ── Auth ──────────────────────────────────────────────────
async function getToken() {
    const c = CFG();
    if (!c.clientId || !c.tenantId || !c.clientSecret)
        throw new Error('Faltan MS_CLIENT_ID / MS_TENANT_ID / MS_CLIENT_SECRET en .env');
    const cca = new msal.ConfidentialClientApplication({
        auth: { clientId: c.clientId, authority: `https://login.microsoftonline.com/${c.tenantId}`, clientSecret: c.clientSecret }
    });
    const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
    if (!r?.accessToken) throw new Error('No se pudo obtener token Azure AD');
    return r.accessToken;
}

async function gGet(token, url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Enviar correo de respuesta con el código ──────────────
async function sendCodeReply(token, toEmail, toName, fileName, code) {
    const mb = CFG().mailbox;
    const body = {
        message: {
            subject: `🔐 Tu código de impresión: ${code}`,
            body: {
                contentType: 'HTML',
                content: `
                <div style="font-family:Arial,sans-serif;max-width:480px;padding:28px;background:#f8fafc;border-radius:14px;border:1px solid #e2e8f0;">
                  <div style="font-size:19px;font-weight:800;color:#1e293b;margin-bottom:10px;">
                    🖨️ Código de impresión
                  </div>
                  <div style="font-size:13.5px;color:#64748b;margin-bottom:22px;line-height:1.6;">
                    Tu archivo <strong style="color:#1e293b;">${fileName}</strong> ha sido recibido
                    y está en cola para impresión.
                  </div>
                  <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;
                              font-size:38px;font-weight:900;letter-spacing:10px;
                              text-align:center;padding:20px 10px;border-radius:12px;
                              margin-bottom:22px;box-shadow:0 4px 14px rgba(59,130,246,.35);">
                    ${code}
                  </div>
                  <div style="font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:14px;line-height:1.7;">
                    ✅ Presenta este código al operador para liberar tu impresión.<br>
                    ⚠️ Es de <strong>un solo uso</strong> — se borra al imprimir.<br>
                    ⏰ El archivo se <strong>eliminará automáticamente en 24 horas</strong> si no se imprime.
                  </div>
                </div>`
            },
            toRecipients: [{ emailAddress: { address: toEmail, name: toName || toEmail } }]
        },
        saveToSentItems: false
    };
    const res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${mb}/sendMail`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`sendMail ${res.status}: ${txt}`);
    }
}

// ── Eliminar correo del buzón ─────────────────────────────
async function deleteMailboxMessage(token, msgId) {
    const mb  = CFG().mailbox;
    const res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${mb}/messages/${msgId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    // 404 = ya no existe, lo consideramos éxito
    if (!res.ok && res.status !== 404) {
        const txt = await res.text();
        throw new Error(`deleteMessage ${res.status}: ${txt}`);
    }
}

// ── Helpers ───────────────────────────────────────────────
function getFileType(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    if (['.pdf'].includes(ext))                               return 'pdf';
    if (['.doc','.docx'].includes(ext))                       return 'word';
    if (['.xls','.xlsx'].includes(ext))                       return 'excel';
    if (['.ppt','.pptx'].includes(ext))                       return 'powerpoint';
    if (['.png','.jpg','.jpeg','.tiff','.bmp'].includes(ext)) return 'image';
    if (['.txt'].includes(ext))                               return 'text';
    return 'other';
}
function extractCopies(subject) {
    const m = (subject || '').match(/[x×*]\s*(\d+)|(\d+)\s*cop/i) ||
              (subject || '').match(/[-–]\s*(\d+)\s*$/);
    if (m) return parseInt(m[1] || m[2]) || 1;
    return 1;
}
function extractPriority(subject) {
    const s = (subject || '').toLowerCase();
    if (s.includes('urgente') || s.includes('urgent') || s.includes('inmediato')) return 'urgente';
    if (s.includes('alta')    || s.includes('high'))    return 'alta';
    if (s.includes('baja')    || s.includes('low'))     return 'baja';
    return 'normal';
}
function deleteLocalFile(fileName) {
    if (!fileName) return;
    try {
        const fp = path.join(ATTACH_DIR, fileName);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch(e) { console.warn('deleteLocalFile:', e.message); }
}

// ── Tablas ────────────────────────────────────────────────
async function ensureTable() {
    await execQuery(equipmentPool, `
        CREATE TABLE IF NOT EXISTS print_queue (
            id                INT AUTO_INCREMENT PRIMARY KEY,
            email_id          VARCHAR(512) NOT NULL,
            email_subject     VARCHAR(512),
            email_from_name   VARCHAR(256),
            email_from_addr   VARCHAR(256),
            received_at       DATETIME,
            importance        VARCHAR(32),
            file_name         VARCHAR(512),
            file_original     VARCHAR(512),
            file_type         VARCHAR(32),
            file_size         BIGINT,
            copies            INT DEFAULT 1,
            priority          VARCHAR(32) DEFAULT 'normal',
            status            VARCHAR(32) DEFAULT 'pendiente',
            is_vip            TINYINT(1) DEFAULT 0,
            print_code        VARCHAR(16),
            email_deleted     TINYINT(1) DEFAULT 0,
            notes             TEXT,
            queued_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
            printed_at        DATETIME,
            printed_by        VARCHAR(256),
            UNIQUE KEY uniq_email_file (email_id(200), file_original(200))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migración suave
    const cols = await execQuery(equipmentPool,
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='print_queue'`
    );
    const existing = new Set(cols.map(c => c.COLUMN_NAME));
    const migrations = [
        ['is_vip',           `ALTER TABLE print_queue ADD COLUMN is_vip TINYINT(1) DEFAULT 0`],
        ['num_pages',        `ALTER TABLE print_queue ADD COLUMN num_pages INT DEFAULT NULL`],
        ['total_print_pages',`ALTER TABLE print_queue ADD COLUMN total_print_pages INT GENERATED ALWAYS AS (COALESCE(num_pages,1)*copies) STORED`],
        ['print_code',       `ALTER TABLE print_queue ADD COLUMN print_code VARCHAR(16)`],
        ['email_deleted',    `ALTER TABLE print_queue ADD COLUMN email_deleted TINYINT(1) DEFAULT 0`],
        ['sharepoint_url',   `ALTER TABLE print_queue ADD COLUMN sharepoint_url VARCHAR(1024)`],
        ['sharepoint_status',`ALTER TABLE print_queue ADD COLUMN sharepoint_status VARCHAR(32) DEFAULT 'local'`],
    ];
    for (const [col, sql] of migrations) {
        if (!existing.has(col)) await execQuery(equipmentPool, sql);
    }

    await execQuery(equipmentPool, `
        CREATE TABLE IF NOT EXISTS print_queue_vip_users (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            email      VARCHAR(256) NOT NULL UNIQUE,
            name       VARCHAR(256),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
}

async function isVip(emailAddr) {
    if (!emailAddr) return false;
    const rows = await execQuery(equipmentPool,
        `SELECT id FROM print_queue_vip_users WHERE LOWER(email)=LOWER(?) LIMIT 1`, [emailAddr]
    );
    return rows.length > 0;
}

// ── Extraer número de páginas ────────────────────────────
async function extractPageCount(filePath, fileType) {
    try {
        if (fileType === 'pdf' && pdfParse) {
            const buf  = fs.readFileSync(filePath);
            const data = await pdfParse(buf, { max: 0 });
            return data.numpages || null;
        }
        if (fileType === 'word') {
            try {
                const AdmZip = require('adm-zip');
                const zip    = new AdmZip(filePath);
                const doc    = zip.readAsText('word/document.xml') || '';
                const breaks = (doc.match(/<w:lastRenderedPageBreak/g)||[]).length;
                return breaks > 0 ? breaks + 1 : null;
            } catch(e) { return null; }
        }
        if (fileType === 'powerpoint') {
            try {
                const AdmZip  = require('adm-zip');
                const zip     = new AdmZip(filePath);
                const slides  = zip.getEntries().filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName));
                return slides.length || null;
            } catch(e) { return null; }
        }
        if (fileType === 'excel') {
            try {
                const AdmZip = require('adm-zip');
                const zip    = new AdmZip(filePath);
                const wb     = zip.readAsText('xl/workbook.xml') || '';
                const sheets = (wb.match(/<sheet /g)||[]).length;
                return sheets || null;
            } catch(e) { return null; }
        }
        if (fileType === 'image') return 1;
        return null;
    } catch(e) { console.warn('extractPageCount:', e.message); return null; }
}

// ── Outlook helpers ───────────────────────────────────────
async function fetchPrintEmails(token, sinceHours = 168) {
    const mb = CFG().mailbox;
    if (!mb) throw new Error('Falta MS_USER_EMAIL en .env');
    const data = await gGet(token,
        `https://graph.microsoft.com/v1.0/users/${mb}/messages` +
        `?$orderby=receivedDateTime desc&$top=200` +
        `&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview,importance`
    );
    const since = new Date(Date.now() - sinceHours * 3600000);
    return (data.value || []).filter(m => {
        const s = (m.subject || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        return s.includes('impresi') && new Date(m.receivedDateTime) >= since;
    });
}

async function downloadAttachments(token, msgId) {
    const mb = CFG().mailbox;
    const attsData = await gGet(token,
        `https://graph.microsoft.com/v1.0/users/${mb}/messages/${msgId}/attachments?$top=25&$select=id,name,size,contentType`
    );
    const printable = (attsData.value || []).filter(a =>
        PRINTABLE_EXTS.has(path.extname(a.name || '').toLowerCase())
    );
    const result = [];
    for (const att of printable) {
        const full = await gGet(token,
            `https://graph.microsoft.com/v1.0/users/${mb}/messages/${msgId}/attachments/${att.id}`
        );
        result.push(full);
    }
    return result;
}

function saveAttachment(att, msgId) {
    try {
        const safeDate = Date.now();
        const safeMsg  = msgId.replace(/[^a-zA-Z0-9]/g,'').substring(0,16);
        const safeName = att.name.replace(/[^a-zA-Z0-9._\-]/g,'_');
        const filename = `${safeDate}_${safeMsg}_${safeName}`;
        const filepath = path.join(ATTACH_DIR, filename);
        const buf      = Buffer.from(att.contentBytes,'base64');
        fs.writeFileSync(filepath, buf);
        return { filename, filepath, size: buf.length };
    } catch(e) { console.warn(`No se pudo guardar ${att.name}:`, e.message); return null; }
}

// ═══════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════

router.get('/stats', async (req, res) => {
    try {
        await ensureTable();
        const [k] = await execQuery(equipmentPool, `
            SELECT
                COUNT(*)                                          AS total,
                SUM(status='pendiente')                           AS pendientes,
                SUM(status='imprimiendo')                         AS imprimiendo,
                SUM(status='completado')                          AS completados,
                SUM(status='cancelado')                           AS cancelados,
                SUM(status='error')                               AS errores,
                SUM(priority='urgente' AND status='pendiente')    AS urgentes,
                SUM(is_vip=1)                                     AS vip_total,
                SUM(is_vip=1 AND status='pendiente')              AS vip_pendientes,
                SUM(is_vip=0 AND status='pendiente')              AS std_pendientes,
                SUM(copies)                                       AS total_copias,
                SUM(status='pendiente' OR status='imprimiendo')   AS en_cola,
                SUM(email_deleted=1)                              AS emails_eliminados,
                SUM(num_pages)                                    AS total_pages_known,
                SUM(COALESCE(num_pages,1)*copies)                 AS total_pages_to_print,
                SUM(CASE WHEN MONTH(queued_at)=MONTH(CURRENT_DATE) AND YEAR(queued_at)=YEAR(CURRENT_DATE)
                    THEN COALESCE(num_pages,1)*copies ELSE 0 END) AS pages_this_month,
                MAX(queued_at)                                    AS ultima_encola
            FROM print_queue
        `);
        const [vc] = await execQuery(equipmentPool, `SELECT COUNT(*) AS total FROM print_queue_vip_users`);
        res.json({ success: true, kpis: k, vip_users_count: +vc.total });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/data', async (req, res) => {
    try {
        await ensureTable();
        const page   = Math.max(1, parseInt(req.query.page)||1);
        const limit  = Math.min(200, parseInt(req.query.limit)||50);
        const offset = (page-1)*limit;
        const search = req.query.search ? `%${req.query.search}%` : null;
        const status = req.query.status || null;
        const prio   = req.query.priority || null;
        const ftype  = req.query.file_type || null;
        const tab    = req.query.tab || 'all';

        const SORT_ALLOW = new Set(['id','email_from_name','email_from_addr','file_name','priority','status','copies','queued_at','received_at','file_size','num_pages']);
        const sortField  = SORT_ALLOW.has(req.query.sort) ? req.query.sort : 'queued_at';
        const sortDir    = req.query.dir==='asc' ? 'ASC' : 'DESC';

        let where = 'WHERE 1=1'; const p = [];
        if (tab==='vip')      { where += ' AND is_vip=1'; }
        if (tab==='standard') { where += ' AND is_vip=0'; }
        if (search) { where += ' AND (email_from_name LIKE ? OR email_from_addr LIKE ? OR file_name LIKE ? OR email_subject LIKE ?)'; p.push(search,search,search,search); }
        if (status) { where += ' AND status=?'; p.push(status); }
        if (prio)   { where += ' AND priority=?'; p.push(prio); }
        if (ftype)  { where += ' AND file_type=?'; p.push(ftype); }

        const [{total}] = await execQuery(equipmentPool, `SELECT COUNT(*) AS total FROM print_queue ${where}`, p);
        const rows = await execQuery(equipmentPool,
            `SELECT id, email_id, email_subject, email_from_name, email_from_addr,
                    received_at, importance, file_name, file_original, file_type, file_size,
                    copies, num_pages, COALESCE(num_pages,1)*copies AS total_print_pages,
                    priority, status, is_vip,
                    print_code, email_deleted,
                    notes, queued_at, printed_at, printed_by
             FROM print_queue ${where}
             ORDER BY
               is_vip DESC,
               CASE priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
               ${sortField} ${sortDir}
             LIMIT ? OFFSET ?`, [...p, limit, offset]
        );
        res.json({ success:true, data:rows, pagination:{ page, limit, total, pages:Math.ceil(total/limit) } });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// ── POST /fetch — descargar correos, generar código y responder ──
router.post('/fetch', async (req, res) => {
    try {
        if (!msal) return res.status(500).json({ success:false, error:'npm install @azure/msal-node node-fetch' });
        await ensureTable();
        console.log('\n📥 PRINT QUEUE FETCH START');
        const token  = await getToken();
        const emails = await fetchPrintEmails(token, parseInt(req.query.hours)||168);
        console.log(`📧 ${emails.length} correos encontrados`);

        let encolados=0, duplicados=0, sinAdj=0;
        const log=[];

        for (const msg of emails) {
            const attachments = await downloadAttachments(token, msg.id);
            if (!attachments.length) {
                sinAdj++;
                log.push({ from: msg.from?.emailAddress?.address, status:'sin_adjuntos' });
                continue;
            }

            const priority = extractPriority(msg.subject);
            const copies   = extractCopies(msg.subject);
            const fromAddr = msg.from?.emailAddress?.address || '';
            const fromName = msg.from?.emailAddress?.name || fromAddr;
            const vip      = await isVip(fromAddr) ? 1 : 0;

            // Un código por correo (mismos adjuntos, mismo código)
            const code = generateCode();
            let codigoEnviado = false;
            let anyNew = false;

            for (const att of attachments) {
                const saved = saveAttachment(att, msg.id);
                try {
                    const ftype    = getFileType(att.name);
                    const fpath    = saved ? saved.filepath : null;
                    const numPages = fpath ? await extractPageCount(fpath, ftype) : null;

                    const result = await execQuery(equipmentPool,
                        `INSERT IGNORE INTO print_queue
                         (email_id,email_subject,email_from_name,email_from_addr,received_at,importance,
                          file_name,file_original,file_type,file_size,copies,priority,status,is_vip,
                          email_deleted,print_code,num_pages)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pendiente',?,0,?,?)`,
                        [msg.id, msg.subject||'',
                         fromName, fromAddr,
                         msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
                         msg.importance||'normal',
                         saved ? saved.filename : att.name, att.name,
                         ftype, saved ? saved.size : (att.size||0),
                         copies, priority, vip, code, numPages]
                    );

                    if (result.affectedRows > 0) {
                        encolados++;
                        anyNew = true;
                        log.push({ from:fromAddr, file:att.name, priority, copies, pages:numPages, vip:!!vip, code, status:'encolado' });
                    } else {
                        duplicados++;
                        log.push({ from:fromAddr, file:att.name, status:'duplicado' });
                    }
                } catch(e) {
                    if ((e.message||'').includes('Duplicate') || e.code==='ER_DUP_ENTRY') {
                        duplicados++;
                        log.push({ from:fromAddr, file:att.name, status:'duplicado' });
                    } else {
                        log.push({ from:fromAddr, file:att.name, status:'error', error:e.message });
                    }
                }
            }

            // Enviar el código al remitente (solo si hay al menos un adjunto nuevo)
            if (anyNew && fromAddr && !codigoEnviado) {
                const firstFile = attachments[0]?.name || 'archivo';
                try {
                    await sendCodeReply(token, fromAddr, fromName, firstFile, code);
                    codigoEnviado = true;
                    console.log(`📨 Código ${code} enviado a ${fromAddr}`);
                } catch(e) {
                    console.warn(`No se pudo enviar código a ${fromAddr}:`, e.message);
                    log.push({ from:fromAddr, status:'error_codigo', error:e.message });
                }
            }
        }

        res.json({ success:true, emails_found:emails.length, encolados, duplicados, sin_adjuntos:sinAdj, log });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// ── POST /:id/validate-code — solo valida el código, NO toca el archivo ──
router.post('/:id/validate-code', async (req, res) => {
    try {
        await ensureTable();
        const { code } = req.body;
        if (!code) return res.status(400).json({ success:false, error:'Código requerido' });

        const [row] = await execQuery(equipmentPool,
            `SELECT id, print_code, status FROM print_queue WHERE id=?`,
            [req.params.id]
        );
        if (!row)
            return res.status(404).json({ success:false, error:'Documento no encontrado' });
        if (row.status === 'completado')
            return res.status(400).json({ success:false, error:'Este documento ya fue impreso' });
        if (String(row.print_code).trim() !== String(code).trim())
            return res.status(403).json({ success:false, error:'Código incorrecto' });

        // Código válido — solo confirmar, el archivo sigue disponible para descarga/impresión
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// ── POST /:id/confirm-printed — marca completado, SIN eliminar el archivo ──
// El archivo físico se elimina 8h después vía /cleanup (llamado por cron/setInterval)
// Se llama desde el frontend 8 horas después de que el usuario lanzó la impresión
router.post('/:id/confirm-printed', async (req, res) => {
    try {
        await ensureTable();
        const { code } = req.body;
        if (!code) return res.status(400).json({ success:false, error:'Código requerido' });

        const [row] = await execQuery(equipmentPool,
            `SELECT id, file_name, file_original, print_code, email_id, email_deleted, status
             FROM print_queue WHERE id=?`, [req.params.id]
        );
        if (!row)
            return res.status(404).json({ success:false, error:'No encontrado' });
        if (String(row.print_code).trim() !== String(code).trim())
            return res.status(403).json({ success:false, error:'Código inválido' });

        // Marcar completado — NO tocar el archivo físico aquí nunca.
        // El cleanup lo eliminará 2h después de printed_at.
        await execQuery(equipmentPool,
            `UPDATE print_queue SET status='completado', printed_at=NOW() WHERE id=?`,
            [req.params.id]
        );

        // Intentar eliminar correo del buzón (no bloquea si falla)
        let emailDeleted = false;
        if (msal && row.email_id && !row.email_deleted) {
            try {
                const token = await getToken();
                await deleteMailboxMessage(token, row.email_id);
                await execQuery(equipmentPool,
                    `UPDATE print_queue SET email_deleted=1 WHERE id=?`, [req.params.id]
                );
                emailDeleted = true;
                console.log(`🗑️  Correo eliminado del buzón — doc #${req.params.id}`);
            } catch(e) {
                console.warn(`No se pudo eliminar correo: ${e.message}`);
            }
        }

        res.json({ success:true, email_deleted:emailDeleted });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// ── POST /:id/print-with-code — endpoint legado (mantener por compatibilidad) ──
router.post('/:id/print-with-code', async (req, res) => {
    req.url = `/${req.params.id}/confirm-printed`;
    router.handle(req, res, () => {});
});

// ── DELETE /:id/mailbox — eliminar correo del buzón manualmente ──
router.delete('/:id/mailbox', async (req, res) => {
    try {
        await ensureTable();
        const [row] = await execQuery(equipmentPool,
            `SELECT email_id, email_deleted FROM print_queue WHERE id=?`, [req.params.id]
        );
        if (!row)               return res.status(404).json({ success:false, error:'No encontrado' });
        if (row.email_deleted)  return res.json({ success:true, already_deleted:true });
        if (!msal)              return res.status(500).json({ success:false, error:'msal no disponible' });

        const token = await getToken();
        await deleteMailboxMessage(token, row.email_id);
        await execQuery(equipmentPool,
            `UPDATE print_queue SET email_deleted=1 WHERE id=?`, [req.params.id]
        );
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// ── POST /cleanup — purga archivos físicos y correos expirados ──
// Lógica:
//   · Completados con printed_at > 2h  → borrar archivo físico + correo
//   · Pendientes/error/cancelados > 24h → borrar archivo físico + correo + marcar cancelado
// Registra este endpoint en app.js con un setInterval cada hora:
//   setInterval(() => fetch('http://localhost:PORT/api/print-queue/cleanup',{method:'POST'}), 60*60*1000);
router.post('/cleanup', async (req, res) => {
    try {
        await ensureTable();

        const expired = await execQuery(equipmentPool,
            `SELECT id, file_name, email_id, email_deleted, status
             FROM print_queue
             WHERE (
                 -- Completados: borrar archivo físico 2h después de imprimirse
                 (status = 'completado' AND printed_at < DATE_SUB(NOW(), INTERVAL 2 HOUR))
                 OR
                 -- Pendientes/error/cancelados sin imprimir: purgar a las 24h
                 (status IN ('pendiente','error','cancelado') AND queued_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
             )`
        );

        if (!expired.length) return res.json({ success:true, purged:0, message:'Nada que purgar' });

        let purged = 0;
        const token = msal ? await getToken().catch(() => null) : null;

        for (const row of expired) {
            // Borrar archivo físico
            deleteLocalFile(row.file_name);

            // Eliminar correo del buzón si no se eliminó antes
            if (token && row.email_id && !row.email_deleted) {
                try {
                    await deleteMailboxMessage(token, row.email_id);
                } catch(e) { console.warn(`cleanup - correo ${row.email_id}:`, e.message); }
            }

            // Actualizar BD — conservar status='completado', solo marcar email_deleted y nota
            await execQuery(equipmentPool,
                `UPDATE print_queue
                 SET email_deleted = 1,
                     status = CASE WHEN status = 'completado' THEN 'completado' ELSE 'cancelado' END,
                     notes  = CONCAT(COALESCE(notes,''),
                              CASE WHEN status = 'completado'
                                   THEN ' [Archivo purgado 2h post-impresión]'
                                   ELSE ' [Auto-purgado 24h sin imprimir]'
                              END)
                 WHERE id = ?`, [row.id]
            );
            purged++;
        }

        console.log(`🧹 Auto-purga completada: ${purged} documentos`);
        res.json({ success:true, purged });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.patch('/:id/status', async (req, res) => {
    try {
        await ensureTable();
        const { status, printed_by, notes } = req.body;
        const VALID = new Set(['pendiente','imprimiendo','completado','cancelado','error']);
        if (!VALID.has(status)) return res.status(400).json({ success:false, error:'Estado inválido' });
        const printed_at = ['completado','error'].includes(status) ? new Date() : null;
        await execQuery(equipmentPool,
            `UPDATE print_queue SET status=?, printed_at=?, printed_by=?, notes=COALESCE(?,notes) WHERE id=?`,
            [status, printed_at, printed_by||null, notes||null, req.params.id]
        );
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.patch('/:id/copies', async (req, res) => {
    try {
        await ensureTable();
        const copies = Math.max(1, parseInt(req.body.copies)||1);
        await execQuery(equipmentPool, `UPDATE print_queue SET copies=? WHERE id=?`, [copies, req.params.id]);
        res.json({ success:true, copies });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await ensureTable();
        const [row] = await execQuery(equipmentPool,
            `SELECT file_name, email_id, email_deleted FROM print_queue WHERE id=?`, [req.params.id]
        );
        if (row?.file_name) deleteLocalFile(row.file_name);
        if (msal && row?.email_id && !row?.email_deleted) {
            try {
                const token = await getToken();
                await deleteMailboxMessage(token, row.email_id);
            } catch(e) { console.warn('delete - correo buzón:', e.message); }
        }
        await execQuery(equipmentPool, `DELETE FROM print_queue WHERE id=?`, [req.params.id]);
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/download/:id', async (req, res) => {
    try {
        await ensureTable();
        const [row] = await execQuery(equipmentPool,
            `SELECT file_name, file_original FROM print_queue WHERE id=?`, [req.params.id]
        );
        if (!row) return res.status(404).json({ error:'No encontrado' });
        const fp = path.join(ATTACH_DIR, row.file_name);
        if (!fs.existsSync(fp)) return res.status(404).json({ error:'Archivo no disponible (purgado o ya impreso)' });
        res.download(fp, row.file_original||row.file_name);
    } catch(err) { res.status(500).json({ error:err.message }); }
});

// ── Analytics ─────────────────────────────────────────────
router.get('/analytics/top-senders', async (req, res) => {
    try {
        await ensureTable();
        const months = Math.min(12, parseInt(req.query.months)||6);
        const top = await execQuery(equipmentPool, `
            SELECT email_from_addr, email_from_name,
                MAX(is_vip) AS is_vip, COUNT(*) AS total_docs,
                SUM(copies) AS total_copies,
                SUM(COALESCE(num_pages,1)*copies) AS total_pages_printed,
                SUM(CASE WHEN status='completado' THEN COALESCE(num_pages,1)*copies ELSE 0 END) AS pages_completed,
                MIN(queued_at) AS first_seen, MAX(queued_at) AS last_seen
            FROM print_queue
            GROUP BY email_from_addr, email_from_name
            ORDER BY total_pages_printed DESC LIMIT 20
        `);
        const monthly = await execQuery(equipmentPool, `
            SELECT email_from_addr, DATE_FORMAT(queued_at,'%Y-%m') AS month,
                COUNT(*) AS docs, SUM(copies) AS copies,
                SUM(COALESCE(num_pages,1)*copies) AS pages
            FROM print_queue
            WHERE queued_at >= DATE_SUB(CURRENT_DATE, INTERVAL ? MONTH)
            GROUP BY email_from_addr, DATE_FORMAT(queued_at,'%Y-%m')
            ORDER BY month DESC, pages DESC
        `, [months]);
        const [totals] = await execQuery(equipmentPool, `
            SELECT COUNT(DISTINCT email_from_addr) AS unique_senders,
                SUM(COALESCE(num_pages,1)*copies) AS grand_total_pages,
                SUM(CASE WHEN MONTH(queued_at)=MONTH(CURRENT_DATE) AND YEAR(queued_at)=YEAR(CURRENT_DATE)
                    THEN COALESCE(num_pages,1)*copies ELSE 0 END) AS pages_this_month,
                SUM(CASE WHEN MONTH(queued_at)=MONTH(CURRENT_DATE) AND YEAR(queued_at)=YEAR(CURRENT_DATE)
                    THEN 1 ELSE 0 END) AS docs_this_month
            FROM print_queue
        `);
        const monthly_global = await execQuery(equipmentPool, `
            SELECT DATE_FORMAT(queued_at,'%Y-%m') AS month,
                COUNT(*) AS docs, COUNT(DISTINCT email_from_addr) AS senders,
                SUM(copies) AS copies, SUM(COALESCE(num_pages,1)*copies) AS pages
            FROM print_queue
            WHERE queued_at >= DATE_SUB(CURRENT_DATE, INTERVAL ? MONTH)
            GROUP BY DATE_FORMAT(queued_at,'%Y-%m')
            ORDER BY month DESC
        `, [months]);
        res.json({ success:true, top, monthly, monthly_global, totals });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

// ── VIP Users ─────────────────────────────────────────────
router.get('/vip-users', async (req, res) => {
    try {
        await ensureTable();
        const rows = await execQuery(equipmentPool,
            `SELECT id,email,name,created_at FROM print_queue_vip_users ORDER BY name ASC`
        );
        res.json({ success:true, data:rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.post('/vip-users', async (req, res) => {
    try {
        await ensureTable();
        const { email, name } = req.body;
        if (!email) return res.status(400).json({ success:false, error:'Email requerido' });
        await execQuery(equipmentPool,
            `INSERT INTO print_queue_vip_users (email,name) VALUES (?,?)
             ON DUPLICATE KEY UPDATE name=VALUES(name)`,
            [email.toLowerCase().trim(), (name||'').trim()]
        );
        const cleanEmail = email.toLowerCase().trim();
        await execQuery(equipmentPool,
            `UPDATE print_queue SET is_vip=1 WHERE LOWER(TRIM(email_from_addr))=?`, [cleanEmail]
        );
        const [upd] = await execQuery(equipmentPool,
            `SELECT COUNT(*) AS cnt FROM print_queue WHERE LOWER(TRIM(email_from_addr))=? AND is_vip=1`, [cleanEmail]
        );
        res.json({ success:true, docs_marked:+upd.cnt });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.delete('/vip-users/:id', async (req, res) => {
    try {
        await ensureTable();
        const [row] = await execQuery(equipmentPool,
            `SELECT email FROM print_queue_vip_users WHERE id=?`, [req.params.id]
        );
        if (row?.email) {
            await execQuery(equipmentPool,
                `UPDATE print_queue SET is_vip=0 WHERE LOWER(email_from_addr)=LOWER(?)`, [row.email]
            );
        }
        await execQuery(equipmentPool, `DELETE FROM print_queue_vip_users WHERE id=?`, [req.params.id]);
        res.json({ success:true });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

console.log('✅ print-queue.js listo — archivo disponible 2h post-impresión + purga automática');
module.exports = router;
